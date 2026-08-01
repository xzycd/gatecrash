import {loadCapture} from './capture.js';
import {prepareRoutes} from './normalize.js';
import {selectedProfiles} from './run.js';
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
  );

  return {
    input,
    targetOrigin: config.target.origin,
    baseline: config.compare.baseline,
    challengers: [...config.compare.against],
    allowedMethods: [...allowedMethods].sort(),
    captured: requests.length,
    routes: prepared.routes.map(({reportId, method, path, pattern, queryNames}) => ({
      id: reportId,
      method,
      path,
      pattern,
      queryNames,
    })),
    skipped: prepared.skipped,
    profiles: profiles.length,
    replays: prepared.routes.length * profiles.length,
  };
}

export async function inspectCapture(
  capturePath: string,
  config: GatecrashConfig,
  allowedMethods: Set<string>,
): Promise<InspectionResult> {
  const requests = await loadCapture(capturePath);
  return inspectRequests(requests, config, allowedMethods, capturePath);
}
