import {createHash} from 'node:crypto';
import {listOf, plural} from '../utils/format.js';
import {responseSimilarity} from './fingerprint.js';
import type {
  Comparison,
  CompareConfig,
  Confidence,
  Finding,
  FindingCrossing,
  InternalResponse,
  PreparedRoute,
  ProfileConfig,
} from './types.js';

/**
 * Below this a response body cannot tell one session's data from another's,
 * so a second session receiving a copy of it says nothing about authorization.
 *
 * Measured against the shapes a capture is actually full of. `[]` and
 * `{"items":[],"total":0}` score zero, because an empty collection is
 * identical for every caller alive. `{"status":"ok"}` scores four. A real
 * record — an owner, an amount, three line items — scores twenty and up. The
 * bar sits above the health check and below anything carrying a name.
 */
const MINIMUM_DISCRIMINATING_BYTES = 16;

export function isDiscriminating(response: InternalResponse): boolean {
  return response.contentBytes >= MINIMUM_DISCRIMINATING_BYTES;
}

function isSuccessful(status: number | undefined): status is number {
  return status !== undefined && status >= 200 && status < 300;
}

function isBlocked(status: number | undefined): status is number {
  return status !== undefined && (status === 401 || status === 403 || status === 404 || status >= 300 && status < 400);
}

function sameBody(left: InternalResponse, right: InternalResponse): boolean {
  return (
    left.error === undefined &&
    right.error === undefined &&
    !left.truncated &&
    !right.truncated &&
    left.normalized !== '' &&
    left.kind === right.kind &&
    left.normalized === right.normalized
  );
}

/**
 * The route ordinal and the baseline name, and nothing else. A finding ID is
 * printed, pasted into tickets, and guessed at offline, so it may not be
 * derived from a URL or a request body.
 */
function findingId(route: PreparedRoute, baseline: string): string {
  const digest = createHash('sha256')
    .update(`${route.reportId}\n${baseline}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `GTC-${digest}`;
}

export function compareResponses(
  baseline: InternalResponse,
  challenger: InternalResponse,
  baselineProfile: ProfileConfig,
  challengerProfile: ProfileConfig,
  config: CompareConfig,
  control?: InternalResponse,
): Comparison {
  if (baseline.error !== undefined || challenger.error !== undefined) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      ...(baseline.status === undefined ? {} : {baselineStatus: baseline.status}),
      ...(challenger.status === undefined ? {} : {challengerStatus: challenger.status}),
      similarity: 0,
      exact: false,
      outcome: 'error',
      reason: challenger.error ?? baseline.error ?? 'A request failed.',
    };
  }

  const similarity = responseSimilarity(baseline, challenger);
  const exact = sameBody(baseline, challenger);

  if (!isSuccessful(baseline.status)) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      ...(baseline.status === undefined ? {} : {baselineStatus: baseline.status}),
      ...(challenger.status === undefined ? {} : {challengerStatus: challenger.status}),
      similarity,
      exact,
      outcome: 'inconclusive',
      reason: `The baseline returned ${baseline.status}, so access could not be established.`,
    };
  }

  if (isBlocked(challenger.status)) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      baselineStatus: baseline.status,
      challengerStatus: challenger.status,
      similarity,
      exact,
      outcome: 'blocked',
      reason: `${challenger.profile} received ${challenger.status}.`,
    };
  }

  if (!isSuccessful(challenger.status)) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      baselineStatus: baseline.status,
      ...(challenger.status === undefined ? {} : {challengerStatus: challenger.status}),
      similarity,
      exact,
      outcome: 'inconclusive',
      reason: `${challenger.profile} received ${challenger.status}.`,
    };
  }

  // Asked before the comparison is scored, because it decides whether there is
  // a boundary here at all. A session carrying no credentials received exactly
  // what the baseline received, so the baseline's response was never behind
  // anything and a third session holding a copy of it has crossed nothing.
  //
  // Guarded on the content, because the same observation means the opposite
  // thing when the body has something in it. A health check reaching an
  // anonymous caller is the endpoint working. An owner, a balance, and two
  // line items reaching one is the worst result this tool can produce, and
  // suppressing it here would hide the exact bug the demo lab ships to
  // demonstrate. That case is escalated in `findingForRoute` instead.
  if (
    control !== undefined &&
    isSuccessful(control.status) &&
    sameBody(baseline, control) &&
    !isDiscriminating(baseline)
  ) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      baselineStatus: baseline.status,
      challengerStatus: challenger.status,
      similarity,
      exact,
      outcome: 'public',
      reason: 'A session with no credentials received the same response, and that response '
        + 'carries nothing specific to a session, so this route is public.',
    };
  }

  const canBeLessPrivileged = challengerProfile.level <= baselineProfile.level;
  if (canBeLessPrivileged && (exact || similarity >= config.similarityThreshold)) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      baselineStatus: baseline.status,
      challengerStatus: challenger.status,
      similarity,
      exact,
      outcome: 'review',
      reason: exact
        ? `${challenger.profile} received the same successful response as ${baseline.profile}.`
        : `${challenger.profile} received a ${Math.round(similarity * 100)}% matching successful response.`,
    };
  }

  if (similarity >= config.similarityThreshold) {
    return {
      baseline: baseline.profile,
      challenger: challenger.profile,
      baselineStatus: baseline.status,
      challengerStatus: challenger.status,
      similarity,
      exact,
      outcome: 'same',
      reason: 'The responses match, but the challenger has a higher configured level.',
    };
  }

  return {
    baseline: baseline.profile,
    challenger: challenger.profile,
    baselineStatus: baseline.status,
    challengerStatus: challenger.status,
    similarity,
    exact,
    outcome: 'changed',
    reason: `Both sessions succeeded, but their response bodies differ.`,
  };
}

/**
 * How much weight a crossing can carry.
 *
 * `high` is the case the tool exists to find: a body that took credentials to
 * produce arrived at a session that did not have them. `medium` is a close
 * match, which on a real application is usually two people's own records in
 * the same shape. `low` is a match the baseline response was never able to
 * prove anything with, and it stays in the report so the operator can see it
 * was considered and rejected rather than never looked at.
 */
export function confidenceFor(baseline: InternalResponse, exact: boolean): Confidence {
  if (!isDiscriminating(baseline)) {
    return 'low';
  }
  return exact ? 'high' : 'medium';
}

/**
 * The control session got through carrying nothing, and what it got back has
 * something in it.
 *
 * This is the strongest statement the tool is able to make, and it is not a
 * `review` comparison because the control is not one of the sessions being
 * judged — it is the reference the others are judged against. It can still
 * be the only thing that got through: a route where every configured session
 * sees its own data, and an unauthenticated request sees the baseline's, has
 * no `review` on it at all.
 */
function controlCrossed(baseline: InternalResponse, control: InternalResponse | undefined): boolean {
  return (
    control !== undefined &&
    isSuccessful(control.status) &&
    sameBody(baseline, control) &&
    isDiscriminating(baseline)
  );
}

export function findingForRoute(
  route: PreparedRoute,
  baselineResponse: InternalResponse,
  comparisons: Comparison[],
  control?: InternalResponse,
): Finding | undefined {
  const reviews = comparisons.filter((comparison) =>
    comparison.outcome === 'review' &&
    comparison.baselineStatus !== undefined &&
    comparison.challengerStatus !== undefined);
  const uncredentialed = controlCrossed(baselineResponse, control);
  const baselineStatus = reviews[0]?.baselineStatus ?? baselineResponse.status;
  if (reviews.length === 0 && !uncredentialed || baselineStatus === undefined) {
    return undefined;
  }

  // Strongest first, so the crossing that set the confidence is the one an
  // operator reads before the screen runs out.
  const crossings: FindingCrossing[] = reviews
    .map((comparison) => ({
      challenger: comparison.challenger,
      status: comparison.challengerStatus ?? 0,
      similarity: comparison.similarity,
      exact: comparison.exact,
    }))
    .sort((left, right) => right.similarity - left.similarity
      || left.challenger.localeCompare(right.challenger));

  if (uncredentialed && control !== undefined) {
    crossings.unshift({
      challenger: control.profile,
      status: control.status ?? 0,
      similarity: 1,
      exact: true,
    });
  }

  const exact = crossings.some((crossing) => crossing.exact);
  const similarity = Math.max(...crossings.map((crossing) => crossing.similarity));
  const confidence = uncredentialed ? 'high' : confidenceFor(baselineResponse, exact);
  const names = listOf(crossings.map((crossing) => crossing.challenger));
  const baseline = baselineResponse.profile;

  const reason = uncredentialed
    ? `A session carrying no credentials received ${baseline}'s response in full. `
      + `${names} reached this route.`
    : confidence === 'low'
      ? `${names} received the same response as ${baseline}, but ${baseline}'s own response `
        + 'carries nothing that would distinguish one session from another, so an identical '
        + 'copy of it is not evidence.'
      : exact
        ? `${names} received the same successful response as ${baseline}.`
        : `${names} received a response matching ${baseline}'s by `
          + `${Math.round(similarity * 100)}%.`;

  const evidence = [
    `${baseline} returned HTTP ${baselineStatus}.`,
    ...crossings.map((crossing) => `${crossing.challenger} returned HTTP ${crossing.status}`
      + `${crossing.exact
        ? ', with an identical normalized body.'
        : `, matching by ${Math.round(crossing.similarity * 100)}%.`}`),
  ];
  if (uncredentialed) {
    evidence.push(
      `That response carries ${plural(baselineResponse.contentBytes, 'byte')} specific enough to `
      + 'tell one session from another, so it was not simply a public route.',
    );
  } else if (confidence === 'low') {
    evidence.push(
      `${baseline}'s response carries ${plural(baselineResponse.contentBytes, 'byte')} that could `
      + `tell one session's data from another's; ${MINIMUM_DISCRIMINATING_BYTES} is the bar.`,
    );
  }

  return {
    id: findingId(route, baseline),
    routeId: route.reportId,
    method: route.method,
    path: route.path,
    baseline,
    baselineStatus,
    crossings,
    similarity,
    exact,
    confidence,
    reason,
    evidence,
  };
}
