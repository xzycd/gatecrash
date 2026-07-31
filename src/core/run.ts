import {randomUUID} from 'node:crypto';
import {REPORT_SCHEMA_VERSION, VERSION} from '../version.js';
import {loadCapture} from './capture.js';
import {compareResponses, findingFromComparison} from './classify.js';
import {GuestlistError} from './errors.js';
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
  GuestlistConfig,
  GuestlistReport,
  InternalResponse,
  ProfileConfig,
  RouteReport,
  RunProgress,
} from './types.js';

function progress(
  options: CheckOptions,
  update: Omit<RunProgress, 'captured' | 'routes' | 'skipped'> & {
    captured?: number;
    routes?: number;
    skipped?: number;
  },
): void {
  options.onProgress?.({
    captured: update.captured ?? 0,
    routes: update.routes ?? 0,
    skipped: update.skipped ?? 0,
    ...update,
  });
}

function selectedProfiles(config: GuestlistConfig): ProfileConfig[] {
  const names = [config.compare.baseline, ...config.compare.against];
  return names.map((name) => {
    const profile = config.profiles.find((candidate) => candidate.name === name);
    if (profile === undefined) {
      throw new GuestlistError(`Profile ${name} is missing from the loaded configuration.`);
    }
    return profile;
  });
}

function responseFor(responses: InternalResponse[], profile: string): InternalResponse {
  const response = responses.find((candidate) => candidate.profile === profile);
  if (response === undefined) {
    throw new GuestlistError(`No response was recorded for profile ${profile}.`);
  }
  return response;
}

export async function checkRequests(
  requests: CapturedRequest[],
  config: GuestlistConfig,
  options: CheckOptions,
): Promise<CheckResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  progress(options, {
    stage: 'capture',
    completed: requests.length,
    total: requests.length,
    detail: `${requests.length} captured request${requests.length === 1 ? '' : 's'}`,
    captured: requests.length,
  });

  const prepared = prepareRoutes(
    requests,
    config.target.origin,
    options.allowedMethods,
    config.exclude,
  );
  progress(options, {
    stage: 'scope',
    completed: prepared.routes.length,
    total: requests.length,
    detail: `${prepared.routes.length} in scope, ${prepared.skipped.length} skipped`,
    captured: requests.length,
    routes: prepared.routes.length,
    skipped: prepared.skipped.length,
  });

  if (prepared.routes.length === 0) {
    throw new GuestlistError('No requests are eligible for replay.', {
      hint: 'Check target.origin, exclusions, and --allow-method options.',
    });
  }

  const profiles = selectedProfiles(config);
  const totalReplays = prepared.routes.length * profiles.length;
  const grouped = await replayRoutes(prepared.routes, profiles, {
    target: config.target,
    compare: config.compare,
    concurrency: config.target.concurrency,
    onResponse: (completed, total, job) => {
      progress(options, {
        stage: 'replay',
        completed,
        total,
        detail: `${job.profile.name} · ${job.route.method} ${job.route.path}`,
        captured: requests.length,
        routes: prepared.routes.length,
        skipped: prepared.skipped.length,
      });
    },
  });

  const baselineProfile = profiles[0];
  if (baselineProfile === undefined) {
    throw new GuestlistError('No baseline profile is available.');
  }
  const findings: Finding[] = [];
  const routeReports: RouteReport[] = [];

  for (const [index, route] of prepared.routes.entries()) {
    const responses = grouped.get(route.id) ?? [];
    const baselineResponse = responseFor(responses, baselineProfile.name);
    const comparisons: Comparison[] = [];

    for (const challengerProfile of profiles.slice(1)) {
      const challengerResponse = responseFor(responses, challengerProfile.name);
      const comparison = compareResponses(
        baselineResponse,
        challengerResponse,
        baselineProfile,
        challengerProfile,
        config.compare,
      );
      comparisons.push(comparison);
      const finding = findingFromComparison(route, comparison);
      if (finding !== undefined) {
        findings.push(finding);
      }
    }

    routeReports.push({
      id: route.id,
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
    });
  }

  const comparisons = routeReports.flatMap((route) => route.comparisons);
  const report: GuestlistReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    toolVersion: VERSION,
    run: {
      id: randomUUID(),
      startedAt,
      durationMs: Math.round(performance.now() - started),
      input: options.inputLabel,
      targetOrigin: config.target.origin,
    },
    config: {
      baseline: config.compare.baseline,
      profiles: profiles.map(({name, level}) => ({name, level})),
      allowedMethods: [...options.allowedMethods].sort(),
      similarityThreshold: config.compare.similarityThreshold,
    },
    summary: {
      captured: requests.length,
      routes: prepared.routes.length,
      replays: totalReplays,
      reviews: findings.length,
      blocked: comparisons.filter(({outcome}) => outcome === 'blocked').length,
      changed: comparisons.filter(({outcome}) => outcome === 'changed').length,
      errors: comparisons.filter(({outcome}) => outcome === 'error').length,
      skipped: prepared.skipped.length,
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
  });

  return {report, ...(reportPath === undefined ? {} : {reportPath})};
}

export async function checkCapture(
  capturePath: string,
  config: GuestlistConfig,
  options: Omit<CheckOptions, 'inputLabel'>,
): Promise<CheckResult> {
  const requests = await loadCapture(capturePath);
  return checkRequests(requests, config, {...options, inputLabel: capturePath});
}
