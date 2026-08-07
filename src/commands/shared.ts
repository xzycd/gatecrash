import {GatecrashError} from '../core/errors.js';
import type {Confidence, OutputFormat} from '../core/types.js';

export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

export function allowedMethods(additional: string[] = []): Set<string> {
  const methods = new Set<string>(SAFE_METHODS);
  for (const rawMethod of additional) {
    const method = rawMethod.toUpperCase();
    if (!/^[A-Z][A-Z0-9-]{0,31}$/.test(method)) {
      throw new GatecrashError(`Invalid HTTP method: ${rawMethod}`);
    }
    methods.add(method);
  }
  return methods;
}

export function outputFormat(value: string): OutputFormat {
  if (value === 'terminal' || value === 'json' || value === 'markdown') {
    return value;
  }
  throw new GatecrashError(`Unknown output format: ${value}`, {
    hint: 'Use terminal, json, or markdown.',
  });
}

/**
 * Which confidence a run is allowed to fail on.
 *
 * `--fail-on-review` failed on every near match, and on a real application
 * every authenticated endpoint produces one — two people's own records have
 * the same shape. A gate that can never pass is a gate teams delete, so the
 * old flag is kept as a name for the tier it actually meant.
 */
export function failOnConfidence(
  value: string | undefined,
  failOnReview = false,
): Confidence | undefined {
  if (value === undefined) {
    return failOnReview ? 'low' : undefined;
  }
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  throw new GatecrashError(`Unknown confidence: ${value}`, {
    hint: 'Use high, medium, or low.',
  });
}
