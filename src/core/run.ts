import {randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import {REPORT_SCHEMA_VERSION, VERSION} from '../version.js';
import {loadCapture} from './capture.js';
import {compareResponses, findingForRoute} from './classify.js';
import {CONTROL_PROFILE} from './config.js';
import {GatecrashError} from './errors.js';
import {publicResponse} from './fingerprint.js';
import {prepareRoutes} from './normalize.js';
import {replayRoutes} from './replay.js';
import {saveReport} from './report.js';
import type {
  CapturedRequest,
  CheckOptions,
  CheckResult,
  Comparison,
  Finding,
  GatecrashConfig,
  GatecrashReport,
  InternalResponse,
  ProfileConfig,
  RouteReport,
  RunProgress,
} from './types.js';

export const MAXIMUM_REPLAYS = 100_000;

/**
 * The reference every other session is measured against: the same request,
 * carrying nothing. Level sits below anything a configuration can express,
 * because it is not competing with the profiles, it is establishing whether
 * they were ever competing for anything.
 */
export const controlProfile: ProfileConfig = {
  name: CONTROL_PROFILE,
  level: -1,
  headers: {},
  cookies: {},
};

export function assertReplayLimit(totalReplays: number): void {
  if (totalReplays > MAXIMUM_REPLAYS) {
    throw new GatecrashError(
      `Replay plan is too large (${totalReplays.toLocaleString()} requests).`,
      {hint: `Reduce the capture or profile set to ${MAXIMUM_REPLAYS.toLocaleString()} replays or fewer.`},
    );
  }
}

function progress(
  options: CheckOptions,
  update: Omit<
    RunProgress,
    'captured' | 'routes' | 'skipped' | 'profiles' | 'replays' | 'baseline' | 'challengers'
  > & {
    captured?: number;
    routes?: number;
    skipped?: number;
    profiles?: number;
    replays?: number;
    baseline?: string;
    challengers?: string[];
  },
): void {
  options.onProgress?.({
    captured: update.captured ?? 0,
    routes: update.routes ?? 0,
    skipped: update.skipped ?? 0,
    profiles: update.profiles ?? 0,
    replays: update.replays ?? 0,
    baseline: update.baseline ?? '',
    challengers: update.challengers ?? [],
    ...update,
  });
}

export function selectedProfiles(config: GatecrashConfig): ProfileConfig[] {
  const names = [config.compare.baseline, ...config.compare.against];
  const chosen = names.map((name) => {
    const profile = config.profiles.find((candidate) => candidate.name === name);
    if (profile === undefined) {
      throw new GatecrashError(`Profile ${name} is missing from the loaded configuration.`);
    }
    return profile;
  });
  return config.compare.control ? [...chosen, controlProfile] : chosen;
}

/** Sessions that are being judged, which is every selected profile but the control. */
export function challengerProfiles(profiles: ProfileConfig[], baseline: string): ProfileConfig[] {
  return profiles.filter((profile) =>
    profile.name !== baseline && profile.name !== CONTROL_PROFILE);
}

function responseFor(responses: InternalResponse[], profile: string): InternalResponse | undefined {
  return responses.find((candidate) => candidate.profile === profile);
}

export function estimatedRunMs(replays: number, requestsPerSecond: number): number {
  return Math.round(replays / Math.max(requestsPerSecond, 0.1) * 1_000);
}

export async function checkRequests(
  requests: CapturedRequest[],
  config: GatecrashConfig,
  options: CheckOptions,
): Promise<CheckResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const profiles = selectedProfiles(config);
  const progressContext = {
    profiles: profiles.length,
    replays: 0,
    baseline: config.compare.baseline,
    challengers: config.compare.against,
  };
  progress(options, {
    stage: 'capture',
    completed: requests.length,
    total: requests.length,
    detail: `${requests.length} captured request${requests.length === 1 ? '' : 's'}`,
    captured: requests.length,
    ...progressContext,
  });

  const prepared = prepareRoutes(
    requests,
    config.target.origin,
    options.allowedMethods,
    config.exclude,
    config.sample.perPattern,
  );
  progress(options, {
    stage: 'scope',
    completed: prepared.routes.length,
    total: requests.length,
    detail: `${prepared.routes.length} in scope, ${prepared.skipped.length} skipped`,
    captured: requests.length,
    routes: prepared.routes.length,
    skipped: prepared.skipped.length,
    ...progressContext,
  });

  if (prepared.routes.length === 0) {
    throw new GatecrashError('No requests are eligible for replay.', {
      hint: 'Check target.origin, exclusions, and --allow-method options.',
    });
  }

  const totalReplays = prepared.routes.length * profiles.length;
  assertReplayLimit(totalReplays);
  const grouped = await replayRoutes(prepared.routes, profiles, {
    target: config.target,
    compare: config.compare,
    concurrency: config.target.concurrency,
    ...(options.signal === undefined ? {} : {signal: options.signal}),
    onResponse: (completed, total, job) => {
      progress(options, {
        stage: 'replay',
        completed,
        total,
        detail: `${job.profile.name} · ${job.route.method} ${job.route.path}`,
        captured: requests.length,
        routes: prepared.routes.length,
        skipped: prepared.skipped.length,
        ...progressContext,
        replays: totalReplays,
        remainingMs: estimatedRunMs(total - completed, config.target.requestsPerSecond),
      });
    },
  });

  const baselineProfile = profiles[0];
  if (baselineProfile === undefined) {
    throw new GatecrashError('No baseline profile is available.');
  }
  const challengers = challengerProfiles(profiles, baselineProfile.name);
  const findings: Finding[] = [];
  const routeReports: RouteReport[] = [];
  let replayed = 0;

  for (const [index, route] of prepared.routes.entries()) {
    const responses = grouped.get(route.id) ?? [];
    const baselineResponse = responseFor(responses, baselineProfile.name);
    // An interrupted run stops mid-plan, so a route can be missing the very
    // response every comparison on it is against. Leaving it out is the only
    // honest thing to do with it; the summary says how many were reached.
    if (baselineResponse === undefined) {
      continue;
    }

    replayed += responses.length;
    const control = config.compare.control
      ? responseFor(responses, CONTROL_PROFILE)
      : undefined;
    const comparisons: Comparison[] = [];

    for (const challengerProfile of challengers) {
      const challengerResponse = responseFor(responses, challengerProfile.name);
      if (challengerResponse === undefined) {
        continue;
      }
      comparisons.push(compareResponses(
        baselineResponse,
        challengerResponse,
        baselineProfile,
        challengerProfile,
        config.compare,
        control,
      ));
    }

    const finding = findingForRoute(route, baselineResponse, comparisons, control);
    if (finding !== undefined) {
      findings.push(finding);
    }

    routeReports.push({
      id: route.reportId,
      method: route.method,
      path: route.path,
      pattern: route.pattern,
      queryNames: route.queryNames,
      responses: responses.map(publicResponse),
      comparisons,
    });
    progress(options, {
      stage: 'compare',
      completed: index + 1,
      total: prepared.routes.length,
      detail: `${route.method} ${route.path}`,
      captured: requests.length,
      routes: prepared.routes.length,
      skipped: prepared.skipped.length,
      ...progressContext,
      replays: totalReplays,
    });
  }

  // Worst first, so the six blocks the screen has room for are the six worth
  // having. Within a tier, a route the control session reached leads: a reply
  // that took no credentials at all is categorically worse news than one that
  // took the wrong operator's.
  const rank = {high: 0, medium: 1, low: 2};
  const uncredentialed = (finding: Finding): number =>
    finding.crossings.some(({challenger}) => challenger === CONTROL_PROFILE) ? 0 : 1;
  findings.sort((left, right) => rank[left.confidence] - rank[right.confidence]
    || uncredentialed(left) - uncredentialed(right)
    || right.similarity - left.similarity
    || left.path.localeCompare(right.path));

  const comparisons = routeReports.flatMap((route) => route.comparisons);
  const interrupted = options.signal?.aborted === true;
  const report: GatecrashReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    toolVersion: VERSION,
    run: {
      id: randomUUID(),
      startedAt,
      durationMs: Math.round(performance.now() - started),
      input: options.inputLabel,
      targetOrigin: config.target.origin,
      ...(interrupted ? {interrupted: true} : {}),
    },
    config: {
      baseline: config.compare.baseline,
      profiles: profiles.map(({name, level}) => ({name, level})),
      control: config.compare.control,
      allowedMethods: [...options.allowedMethods].sort(),
      similarityThreshold: config.compare.similarityThreshold,
      samplePerPattern: config.sample.perPattern,
    },
    summary: {
      captured: requests.length,
      skipped: prepared.skipped.length,
      sampled: prepared.skipped.filter(({reason}) => reason === 'sampled').length,
      routes: routeReports.length,
      findings: findings.length,
      high: findings.filter(({confidence}) => confidence === 'high').length,
      medium: findings.filter(({confidence}) => confidence === 'medium').length,
      low: findings.filter(({confidence}) => confidence === 'low').length,
      replays: replayed,
      comparisons: comparisons.length,
      reviews: comparisons.filter(({outcome}) => outcome === 'review').length,
      publicResults: comparisons.filter(({outcome}) => outcome === 'public').length,
      blocked: comparisons.filter(({outcome}) => outcome === 'blocked').length,
      changed: comparisons.filter(({outcome}) => outcome === 'changed').length,
      errors: comparisons.filter(({outcome}) => outcome === 'error').length,
    },
    routes: routeReports,
    findings,
    skipped: prepared.skipped,
  };

  let reportPath: string | undefined;
  if (options.save) {
    reportPath = await saveReport(report, options.outputPath);
  }
  progress(options, {
    stage: 'report',
    completed: 1,
    total: 1,
    detail: reportPath ?? 'Report kept in memory',
    captured: requests.length,
    routes: prepared.routes.length,
    skipped: prepared.skipped.length,
    ...progressContext,
    replays: totalReplays,
  });

  return {
    report,
    ...(reportPath === undefined ? {} : {reportPath}),
    ...(interrupted ? {interrupted: true} : {}),
  };
}

export async function checkCapture(
  capturePath: string,
  config: GatecrashConfig,
  options: Omit<CheckOptions, 'inputLabel'>,
): Promise<CheckResult> {
  const requests = await loadCapture(capturePath);
  return checkRequests(requests, config, {...options, inputLabel: basename(capturePath)});
}
