import {createHash} from 'node:crypto';
import {responseSimilarity} from './fingerprint.js';
import type {
  Comparison,
  CompareConfig,
  Finding,
  InternalResponse,
  PreparedRoute,
  ProfileConfig,
} from './types.js';

function isSuccessful(status: number | undefined): status is number {
  return status !== undefined && status >= 200 && status < 300;
}

function isBlocked(status: number | undefined): status is number {
  return status !== undefined && (status === 401 || status === 403 || status === 404 || status >= 300 && status < 400);
}

function findingId(route: PreparedRoute, baseline: string, challenger: string): string {
  const digest = createHash('sha256')
    .update(`${route.method}\n${route.path}\n${baseline}\n${challenger}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `GST-${digest}`;
}

export function compareResponses(
  baseline: InternalResponse,
  challenger: InternalResponse,
  baselineProfile: ProfileConfig,
  challengerProfile: ProfileConfig,
  config: CompareConfig,
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
  const exact =
    !baseline.truncated &&
    !challenger.truncated &&
    baseline.normalized !== '' &&
    baseline.kind === challenger.kind &&
    baseline.normalized === challenger.normalized;

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

export function findingFromComparison(
  route: PreparedRoute,
  comparison: Comparison,
): Finding | undefined {
  if (
    comparison.outcome !== 'review' ||
    comparison.baselineStatus === undefined ||
    comparison.challengerStatus === undefined
  ) {
    return undefined;
  }

  const similarityText = comparison.exact
    ? 'The normalized response bodies are identical.'
    : `The normalized response bodies match by ${Math.round(comparison.similarity * 100)}%.`;

  return {
    id: findingId(route, comparison.baseline, comparison.challenger),
    routeId: route.id,
    method: route.method,
    path: route.path,
    baseline: comparison.baseline,
    challenger: comparison.challenger,
    baselineStatus: comparison.baselineStatus,
    challengerStatus: comparison.challengerStatus,
    similarity: comparison.similarity,
    exact: comparison.exact,
    confidence: comparison.exact ? 'high' : 'medium',
    reason: comparison.reason,
    evidence: [
      `${comparison.baseline} returned HTTP ${comparison.baselineStatus}.`,
      `${comparison.challenger} returned HTTP ${comparison.challengerStatus}.`,
      similarityText,
    ],
  };
}
