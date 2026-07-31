import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {GuestlistError} from './errors.js';
import type {CapturedRequest} from './types.js';

type UnknownRecord = Record<string, unknown>;

const CAPTURE_HEADER_DENYLIST = new Set([
  'accept-encoding',
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'proxy-authorization',
  'proxy-connection',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-api-key',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function requestId(method: string, url: string, body = ''): string {
  return `route-${shortHash(`${method}\n${url}\n${body}`)}`;
}

function parseUrl(value: string, source: string): URL {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }

    url.hash = '';
    return url;
  } catch {
    throw new GuestlistError(`Invalid URL in ${source}: ${value}`);
  }
}

export function sanitizeCapturedHeaders(
  entries: Array<{name: string; value: string}> | Record<string, string>,
): Record<string, string> {
  const pairs: Array<[string, string]> = Array.isArray(entries)
    ? entries.map(({name, value}) => [name, value])
    : Object.entries(entries);
  const sanitized: Record<string, string> = {};

  for (const [name, value] of pairs) {
    const normalizedName = name.toLowerCase();
    if (!CAPTURE_HEADER_DENYLIST.has(normalizedName)) {
      sanitized[normalizedName] = value;
    }
  }

  return sanitized;
}

function harHeaders(value: unknown): Array<{name: string; value: string}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.value !== 'string') {
      return [];
    }

    return [{name: entry.name, value: entry.value}];
  });
}

export function parseHar(value: unknown, source = 'HAR input'): CapturedRequest[] {
  if (!isRecord(value) || !isRecord(value.log) || !Array.isArray(value.log.entries)) {
    throw new GuestlistError(`${source} is not a valid HAR file.`, {
      hint: 'Expected a log.entries array containing captured requests.',
    });
  }

  const requests: CapturedRequest[] = [];
  for (const [index, entry] of value.log.entries.entries()) {
    if (!isRecord(entry) || !isRecord(entry.request)) {
      continue;
    }

    const methodValue = entry.request.method;
    const urlValue = entry.request.url;
    if (typeof methodValue !== 'string' || typeof urlValue !== 'string') {
      continue;
    }

    const method = methodValue.toUpperCase();
    const postData = isRecord(entry.request.postData) ? entry.request.postData : undefined;
    const body = typeof postData?.text === 'string' ? postData.text : undefined;
    const url = parseUrl(urlValue, `${source}, entry ${index + 1}`);
    requests.push({
      id: requestId(method, url.href, body),
      method,
      url,
      headers: sanitizeCapturedHeaders(harHeaders(entry.request.headers)),
      ...(body === undefined ? {} : {body}),
      source: `${source}:${index + 1}`,
    });
  }

  if (requests.length === 0) {
    throw new GuestlistError(`${source} does not contain any usable HTTP requests.`);
  }

  return requests;
}

function nestedString(record: UnknownRecord, paths: string[][]): string | undefined {
  for (const path of paths) {
    let current: unknown = record;
    for (const part of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }

      current = current[part];
    }

    if (typeof current === 'string') {
      return current;
    }
  }

  return undefined;
}

function parseJsonLine(line: string, source: string): CapturedRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const urlValue = nestedString(value, [
    ['url'],
    ['endpoint'],
    ['request', 'url'],
    ['request', 'endpoint'],
  ]);
  if (urlValue === undefined) {
    throw new GuestlistError(`JSON line in ${source} has no URL or endpoint field.`);
  }

  const method = (nestedString(value, [['method'], ['request', 'method']]) ?? 'GET').toUpperCase();
  const url = parseUrl(urlValue, source);
  return {
    id: requestId(method, url.href),
    method,
    url,
    headers: {},
    source,
  };
}

export function parseUrlList(contents: string, source = 'URL input'): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const lineSource = `${source}:${index + 1}`;
    if (line.startsWith('{')) {
      const request = parseJsonLine(line, lineSource);
      if (request !== undefined) {
        requests.push(request);
        continue;
      }
    }

    const match = /^(?:(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\s+)?(https?:\/\/\S+)$/i.exec(line);
    if (match === null) {
      throw new GuestlistError(`Could not read line ${index + 1} in ${source}.`, {
        hint: 'Use an absolute URL, an optional HTTP method followed by a URL, or Katana JSONL.',
      });
    }

    const method = (match[1] ?? 'GET').toUpperCase();
    const urlValue = match[2];
    if (urlValue === undefined) {
      continue;
    }

    const url = parseUrl(urlValue, lineSource);
    requests.push({
      id: requestId(method, url.href),
      method,
      url,
      headers: {},
      source: lineSource,
    });
  }

  if (requests.length === 0) {
    throw new GuestlistError(`${source} does not contain any URLs.`);
  }

  return requests;
}

export async function loadCapture(path: string): Promise<CapturedRequest[]> {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      throw new GuestlistError(`Capture file not found: ${path}`, {
        hint: 'Export a HAR file from your browser or pass a text file of URLs.',
      });
    }

    throw error;
  }

  const trimmed = contents.trim();
  const harExtension = extname(path).toLowerCase() === '.har';
  let parsedDocument: unknown;
  if (harExtension || trimmed.startsWith('{')) {
    try {
      parsedDocument = JSON.parse(contents) as unknown;
    } catch (error) {
      if (harExtension) {
        throw new GuestlistError(`Could not parse HAR file: ${path}`, {
          hint: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const parsedRecord = isRecord(parsedDocument) ? parsedDocument : undefined;
  const looksLikeHar = parsedRecord !== undefined && isRecord(parsedRecord.log) && Array.isArray(parsedRecord.log.entries);
  if (harExtension || looksLikeHar) {
    return parseHar(parsedDocument, path);
  }

  return parseUrlList(contents, path);
}
