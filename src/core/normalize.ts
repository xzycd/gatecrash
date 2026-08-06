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

// A capture is full of identifiers, and an identifier in a report is a value
// somebody can look up. Anything that reads as one is replaced by the shape it
// had rather than the value it held.
function placeholderFor(segment: string): string | undefined {
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
  return undefined;
}

export function normalizePath(pathname: string): string {
  const segments = pathname.split('/').map((segment) => placeholderFor(segment) ?? segment);
  return segments.join('/') || '/';
}

// A report may carry query names. It may never carry query values.
const MAXIMUM_QUERY_NAMES = 64;
const MAXIMUM_QUERY_NAME_LENGTH = 128;

/**
 * Splitting on `=` and keeping the left side looks like it only ever yields
 * names, and for `?page=2` it does. For `?eyJhbGciOiJIUzI1NiJ9...` there is no
 * `=` at all, so the whole token became its own "name" and went into the saved
 * report — a query value persisted verbatim, which is the one thing the report
 * rules forbid. A part with no `=` is treated as a value here and only kept
 * when it still looks like a name after normalization.
 */
export function displayPath(url: URL): {path: string; queryNames: string[]} {
  const names = new Set<string>();
  for (const part of url.search.slice(1).split('&')) {
    if (part === '' || names.size >= MAXIMUM_QUERY_NAMES) {
      continue;
    }

    const separator = part.indexOf('=');
    const raw = separator === -1 ? part : part.slice(0, separator);
    if (raw === '') {
      continue;
    }

    const name = placeholderFor(raw) ?? (separator === -1 && raw.length > 32 ? '{value}' : raw);
    names.add(name.slice(0, MAXIMUM_QUERY_NAME_LENGTH));
  }

  const queryNames = [...names].sort();
  return {
    path: `${url.pathname}${queryNames.length === 0 ? '' : `?${queryNames.join('&')}`}`,
    queryNames,
  };
}

// `?` was missing from the escape set, so `/admin?/**` compiled to a regex in
// which the `n` was optional: the pattern silently excluded a different set of
// paths than it read as. An exclusion that does not mean what it says is how a
// route gets replayed that the operator believed was out of scope.
const REGEXP_METACHARACTERS = /[.+^${}()|[\]\\?]/g;
const globCache = new Map<string, RegExp>();

function globExpression(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }

  const escaped = pattern
    .replaceAll(REGEXP_METACHARACTERS, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  const expression = new RegExp(`^${escaped}$`);
  globCache.set(pattern, expression);
  return expression;
}

export function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globExpression(pattern).test(pathname));
}

function extensionExcluded(pathname: string, extensions: string[]): boolean {
  const filename = pathname.split('/').at(-1) ?? '';
  const extension = filename.includes('.') ? filename.split('.').at(-1)?.toLowerCase() : undefined;
  return extension !== undefined && extensions.includes(extension);
}

export interface RouteFamily {
  method: string;
  pattern: string;
  matched: number;
  replayed: number;
}

interface PrepareResult {
  routes: PreparedRoute[];
  skipped: SkippedRoute[];
  families: RouteFamily[];
}

function familyKey(route: PreparedRoute): string {
  return `${route.method}\n${route.pattern}\n${route.queryNames.join('&')}`;
}

/**
 * Which members of a route family to actually send.
 *
 * A capture of a paginated list is two hundred rows of `/api/files/{int}`
 * that differ only in an identifier the tool already declines to record. Every
 * one of them costs a request per session, and at the default two per second a
 * six-hundred-route capture is a quarter of an hour before it says anything.
 *
 * The picks are spread across the family rather than taken from the front,
 * because the front of a capture is one page of one list, and an identifier
 * that behaves differently is likelier to be at the far end of the range than
 * next door to the first one.
 */
export function samplePositions(size: number, keep: number): number[] {
  if (keep <= 0 || keep >= size) {
    return Array.from({length: size}, (_, index) => index);
  }
  if (keep === 1) {
    return [0];
  }

  const positions = new Set<number>();
  for (let index = 0; index < keep; index += 1) {
    positions.add(Math.round(index * (size - 1) / (keep - 1)));
  }
  return [...positions].sort((left, right) => left - right);
}

export function prepareRoutes(
  requests: CapturedRequest[],
  origin: string,
  allowedMethods: Set<string>,
  exclude: ExcludeConfig,
  perPattern = 0,
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

  // Families are reported whether or not sampling is on, because "these two
  // hundred rows are one endpoint" is worth saying even when all two hundred
  // are about to be sent.
  const grouped = new Map<string, PreparedRoute[]>();
  for (const route of routes) {
    const key = familyKey(route);
    grouped.set(key, [...grouped.get(key) ?? [], route]);
  }

  const kept: PreparedRoute[] = [];
  const families: RouteFamily[] = [];
  for (const members of grouped.values()) {
    const ordered = [...members].sort((left, right) => left.path.localeCompare(right.path));
    const positions = new Set(samplePositions(ordered.length, perPattern));
    const first = ordered[0];
    if (first === undefined) {
      continue;
    }

    families.push({
      method: first.method,
      pattern: first.pattern,
      matched: ordered.length,
      replayed: Math.min(positions.size, ordered.length),
    });

    for (const [index, route] of ordered.entries()) {
      if (positions.has(index)) {
        kept.push(route);
      } else {
        skipped.push({
          id: route.reportId,
          method: route.method,
          path: route.path,
          reason: 'sampled',
          detail: `${first.method} ${first.pattern} matched ${ordered.length} routes; `
            + `${positions.size} were replayed.`,
        });
      }
    }
  }

  // Capture order is what the operator sees in their proxy, and a report that
  // reorders it for an internal grouping step is harder to follow back.
  const order = new Map(routes.map((route, index) => [route.id, index]));
  kept.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  families.sort((left, right) => right.matched - left.matched
    || left.pattern.localeCompare(right.pattern));

  return {routes: kept, skipped, families};
}
