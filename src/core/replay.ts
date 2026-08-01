import {VERSION} from '../version.js';
import {COMMAND_NAME} from '../brand.js';
import {errorResponse, fingerprintResponse} from './fingerprint.js';
import type {
  CompareConfig,
  InternalResponse,
  PreparedRoute,
  ProfileConfig,
  TargetConfig,
} from './types.js';

interface ReplayJob {
  route: PreparedRoute;
  profile: ProfileConfig;
}

interface ReplayOptions {
  target: TargetConfig;
  compare: CompareConfig;
  concurrency: number;
  onResponse?: (completed: number, total: number, job: ReplayJob) => void;
}

interface LimitedBody {
  body: Uint8Array;
  truncated: boolean;
}

class RateGate {
  readonly intervalMs: number;
  #next = 0;
  #queue = Promise.resolve();

  constructor(requestsPerSecond: number) {
    this.intervalMs = 1_000 / requestsPerSecond;
  }

  async wait(): Promise<void> {
    let release: (() => void) | undefined;
    const previous = this.#queue;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    const now = performance.now();
    const delay = Math.max(0, this.#next - now);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    this.#next = performance.now() + this.intervalMs;
    release?.();
  }
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (existing !== undefined) {
    delete headers[existing];
  }
  headers[name] = value;
}

function requestHeaders(route: PreparedRoute, profile: ProfileConfig): Record<string, string> {
  const headers = {...route.headers};
  for (const [name, value] of Object.entries(profile.headers)) {
    setHeader(headers, name, value);
  }

  const cookies = Object.entries(profile.cookies).map(([name, value]) => `${name}=${value}`);
  if (cookies.length > 0) {
    setHeader(headers, 'cookie', cookies.join('; '));
  }

  setHeader(headers, 'accept-encoding', 'identity');
  setHeader(headers, 'user-agent', `${COMMAND_NAME}/${VERSION}`);
  return headers;
}

function networkError(error: unknown, timeoutMs: number): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `Timed out after ${timeoutMs} ms.`;
  }

  const cause = error instanceof Error && typeof error.cause === 'object' && error.cause !== null
    ? error.cause as Record<string, unknown>
    : undefined;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  const known: Record<string, string> = {
    ECONNREFUSED: 'Connection refused.',
    ECONNRESET: 'Connection reset.',
    ENETUNREACH: 'Network unreachable.',
    ENOTFOUND: 'Host could not be resolved.',
    ETIMEDOUT: 'Connection timed out.',
    UND_ERR_CONNECT_TIMEOUT: 'Connection timed out.',
  };
  if (code === undefined || !/^[A-Z0-9_]{1,40}$/.test(code)) {
    return 'Network request failed.';
  }
  return known[code] ?? `Network request failed (${code}).`;
}

async function readLimitedBody(response: Response, maximumBytes: number): Promise<LimitedBody> {
  if (response.body === null) {
    return {body: new Uint8Array(), truncated: false};
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;

  while (true) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }

    const remaining = maximumBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }

    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      bytes += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(value);
    bytes += value.byteLength;
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {body, truncated};
}

async function replayOne(
  job: ReplayJob,
  target: TargetConfig,
  compare: CompareConfig,
  gate: RateGate,
): Promise<InternalResponse> {
  await gate.wait();
  const started = performance.now();
  if (job.route.url.origin !== target.origin) {
    return errorResponse(
      job.profile.name,
      'Replay stopped because the route left the configured origin.',
      0,
    );
  }
  try {
    const canHaveBody = !['GET', 'HEAD'].includes(job.route.method);
    const response = await fetch(job.route.url, {
      method: job.route.method,
      headers: requestHeaders(job.route, job.profile),
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(target.timeoutMs),
      ...(canHaveBody && job.route.body !== undefined ? {body: job.route.body} : {}),
    });
    const {body, truncated} = await readLimitedBody(response, target.maxResponseBytes);
    return fingerprintResponse({
      profile: job.profile.name,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
      durationMs: Math.round(performance.now() - started),
      truncated,
      volatileJsonKeys: compare.volatileJsonKeys,
    });
  } catch (error) {
    const message = networkError(error, target.timeoutMs);
    return errorResponse(job.profile.name, message, Math.round(performance.now() - started));
  }
}

async function runWorkers<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const work = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  };

  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, work));
  return results;
}

export async function replayRoutes(
  routes: PreparedRoute[],
  profiles: ProfileConfig[],
  options: ReplayOptions,
): Promise<Map<string, InternalResponse[]>> {
  const jobs = routes.flatMap((route) => profiles.map((profile) => ({route, profile})));
  const gate = new RateGate(options.target.requestsPerSecond);
  let completed = 0;
  const responses = await runWorkers(jobs, options.concurrency, async (job) => {
    const response = await replayOne(job, options.target, options.compare, gate);
    completed += 1;
    options.onResponse?.(completed, jobs.length, job);
    return response;
  });

  const grouped = new Map<string, InternalResponse[]>();
  for (const [index, job] of jobs.entries()) {
    const response = responses[index];
    if (response === undefined) {
      continue;
    }
    const existing = grouped.get(job.route.id) ?? [];
    existing.push(response);
    grouped.set(job.route.id, existing);
  }

  return grouped;
}
