import {GatecrashError} from '../core/errors.js';
import type {OutputFormat} from '../core/types.js';

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
