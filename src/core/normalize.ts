import {createHash} from 'node:crypto';
import type {
  CapturedRequest,
  ExcludeConfig,
  PreparedRoute,
  SkippedRoute,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGER = /^\d+$/;
const HEX_ID = /^[0-9a-f]{16,64}$/i;
const LONG_TOKEN = /^[A-Za-z0-9_-]{24,}$/;

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function normalizePath(pathname: string): string {
  const segments = pathname.split('/').map((segment) => {
    if (UUID.test(segment)) {
      return '{uuid}';
    }
    if (INTEGER.test(segment)) {
      return '{int}';
    }
    if (HEX_ID.test(segment)) {
      return '{hex}';
    }
    if (LONG_TOKEN.test(segment)) {
      return '{token}';
    }
    return segment;
  });

  return segments.join('/') || '/';
}

export function displayPath(url: URL): {path: string; queryNames: string[]} {
  const queryNames = [...new Set(
    url.search
      .slice(1)
      .split('&')
      .map((part) => part.split('=', 1)[0] ?? '')
      .filter((name) => name !== ''),
  )].sort();
  return {
    path: `${url.pathname}${queryNames.length === 0 ? '' : `?${queryNames.join('&')}`}`,
    queryNames,
  };
}

function globExpression(pattern: string): RegExp {
  const escaped = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globExpression(pattern).test(pathname));
}

function extensionExcluded(pathname: string, extensions: string[]): boolean {
  const filename = pathname.split('/').at(-1) ?? '';
  const extension = filename.includes('.') ? filename.split('.').at(-1)?.toLowerCase() : undefined;
  return extension !== undefined && extensions.includes(extension);
}

interface PrepareResult {
  routes: PreparedRoute[];
  skipped: SkippedRoute[];
}

export function prepareRoutes(
  requests: CapturedRequest[],
  origin: string,
  allowedMethods: Set<string>,
  exclude: ExcludeConfig,
): PrepareResult {
  const routes: PreparedRoute[] = [];
  const skipped: SkippedRoute[] = [];
  const seen = new Set<string>();

  for (const [requestIndex, request] of requests.entries()) {
    const {path, queryNames} = displayPath(request.url);
    // Persist only a report-local ordinal. Hashing the request URL or body into
    // a public ID would still expose a value that can be guessed offline.
    const reportId = `route-${String(requestIndex + 1).padStart(4, '0')}`;
    const skip = (reason: SkippedRoute['reason'], detail: string): void => {
      skipped.push({id: reportId, method: request.method, path, reason, detail});
    };

    if (request.url.origin !== origin) {
      skip('out-of-scope', `Expected ${origin}; capture points to ${request.url.origin}.`);
      continue;
    }

    if (!allowedMethods.has(request.method)) {
      skip('unsafe-method', `${request.method} requires --allow-method ${request.method}.`);
      continue;
    }

    if (
      matchesPath(request.url.pathname, exclude.paths) ||
      extensionExcluded(request.url.pathname, exclude.extensions)
    ) {
      skip('excluded', 'Matched an excluded path or file extension.');
      continue;
    }

    const dedupeKey = `${request.method}\n${request.url.href}\n${request.body ?? ''}`;
    if (seen.has(dedupeKey)) {
      skip('duplicate', 'An identical request was already prepared.');
      continue;
    }
    seen.add(dedupeKey);

    routes.push({
      id: `route-${shortHash(dedupeKey)}`,
      reportId,
      method: request.method,
      url: request.url,
      path,
      pattern: normalizePath(request.url.pathname),
      queryNames,
      headers: request.headers,
      ...(request.body === undefined ? {} : {body: request.body}),
      source: request.source,
    });
  }

  return {routes, skipped};
}
