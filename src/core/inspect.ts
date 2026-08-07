import {basename} from 'node:path';
import {loadCapture} from './capture.js';
import {prepareRoutes} from './normalize.js';
import {estimatedRunMs, selectedProfiles} from './run.js';
import type {
  CapturedRequest,
  GatecrashConfig,
  InspectionResult,
} from './types.js';

export function inspectRequests(
  requests: CapturedRequest[],
  config: GatecrashConfig,
  allowedMethods: Set<string>,
  input: string,
): InspectionResult {
  const profiles = selectedProfiles(config);
  const prepared = prepareRoutes(
    requests,
    config.target.origin,
    allowedMethods,
    config.exclude,
    config.sample.perPattern,
  );

  const replays = prepared.routes.length * profiles.length;
  return {
    input,
    targetOrigin: config.target.origin,
    baseline: config.compare.baseline,
    challengers: [...config.compare.against],
    control: config.compare.control,
    allowedMethods: [...allowedMethods].sort(),
    captured: requests.length,
    routes: prepared.routes.map(({reportId, method, path, pattern, queryNames}) => ({
      id: reportId,
      method,
      path,
      pattern,
      queryNames,
    })),
    families: prepared.families,
    skipped: prepared.skipped,
    profiles: profiles.length,
    replays,
    // The number that decides whether this is a command you run now or after
    // lunch. At the default two requests a second, a six-hundred-route capture
    // across three sessions is a quarter of an hour.
    estimatedMs: estimatedRunMs(replays, config.target.requestsPerSecond),
  };
}

export async function inspectCapture(
  capturePath: string,
  config: GatecrashConfig,
  allowedMethods: Set<string>,
): Promise<InspectionResult> {
  const requests = await loadCapture(capturePath);
  // A basename, never the directory it sat in. `inspect --format json` is
  // pasted into tickets and chat, and `check` has always labelled its input
  // this way; passing the whole path here leaked the operator's local layout
  // into every preview.
  return inspectRequests(requests, config, allowedMethods, basename(capturePath));
}
