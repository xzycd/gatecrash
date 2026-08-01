import {extname, resolve} from 'node:path';
import {hasErrorCode, readLimitedUtf8File} from '../utils/files.js';
import {containsRequestControl} from '../utils/security.js';
import {GatecrashError} from './errors.js';
import type {CapturedRequest} from './types.js';

type UnknownRecord = Record<string, unknown>;

const CAPTURE_MAXIMUM_BYTES = 100_000_000;
const CAPTURE_MAXIMUM_REQUESTS = 100_000;
const CAPTURE_MAXIMUM_URL_LENGTH = 16_384;
// A captured body is replayed once per profile, so a single HAR entry decides
// how much Gatecrash uploads to the target. Generous enough for a real file
// upload, bounded enough that a crafted capture cannot turn the tool into an
// amplifier pointed at somebody's staging environment.
const CAPTURE_MAXIMUM_BODY_BYTES = 8_000_000;
const HTTP_METHOD = /^[A-Z][A-Z0-9-]{0,31}$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// A HAR is untrusted input and custom headers often carry credentials. Only
// representation headers survive capture ingestion. Session headers come from
// the explicit profile configuration.
const CAPTURE_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'content-type',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUrl(value: string, source: string): URL {
  if (value.length > CAPTURE_MAXIMUM_URL_LENGTH) {
    throw new GatecrashError(`URL in ${source} is too long.`);
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
    if (url.username !== '' || url.password !== '') {
      throw new Error('embedded credentials');
    }

    url.hash = '';
    return url;
  } catch {
    throw new GatecrashError(`Invalid HTTP URL in ${source}.`);
  }
}

function parseMethod(value: string, source: string): string {
  const method = value.toUpperCase();
  if (!HTTP_METHOD.test(method)) {
    throw new GatecrashError(`Invalid HTTP method in ${source}.`);
  }
  return method;
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
    if (
      HEADER_NAME.test(name) &&
      CAPTURE_HEADER_ALLOWLIST.has(normalizedName) &&
      value.length <= 16_384 &&
      !containsRequestControl(value)
    ) {
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
    throw new GatecrashError(`${source} is not a valid HAR file.`, {
      hint: 'Expected a log.entries array containing captured requests.',
    });
  }

  if (value.log.entries.length > CAPTURE_MAXIMUM_REQUESTS) {
    throw new GatecrashError(
      `${source} contains more than ${CAPTURE_MAXIMUM_REQUESTS.toLocaleString()} entries.`,
      {hint: 'Split the capture into smaller, reviewable runs.'},
    );
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

    const method = parseMethod(methodValue, `${source}, entry ${index + 1}`);
    const postData = isRecord(entry.request.postData) ? entry.request.postData : undefined;
    const body = typeof postData?.text === 'string' ? postData.text : undefined;
    if (body !== undefined && Buffer.byteLength(body, 'utf8') > CAPTURE_MAXIMUM_BODY_BYTES) {
      throw new GatecrashError(
        `Request body in ${source}, entry ${index + 1} is larger than ${CAPTURE_MAXIMUM_BODY_BYTES.toLocaleString()} bytes.`,
        {hint: 'Remove the large upload from the capture before replaying it.'},
      );
    }
    const url = parseUrl(urlValue, `${source}, entry ${index + 1}`);
    requests.push({
      method,
      url,
      headers: sanitizeCapturedHeaders(harHeaders(entry.request.headers)),
      ...(body === undefined ? {} : {body}),
      source: `${source}:${index + 1}`,
    });
  }

  if (requests.length === 0) {
    throw new GatecrashError(`${source} does not contain any usable HTTP requests.`);
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
    throw new GatecrashError(`JSON line in ${source} has no URL or endpoint field.`);
  }

  const method = parseMethod(
    nestedString(value, [['method'], ['request', 'method']]) ?? 'GET',
    source,
  );
  const url = parseUrl(urlValue, source);
  return {
    method,
    url,
    headers: {},
    source,
  };
}

export function parseUrlList(contents: string, source = 'URL input'): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > CAPTURE_MAXIMUM_REQUESTS) {
    throw new GatecrashError(
      `${source} contains more than ${CAPTURE_MAXIMUM_REQUESTS.toLocaleString()} lines.`,
      {hint: 'Split the capture into smaller, reviewable runs.'},
    );
  }

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
      throw new GatecrashError(`Could not read line ${index + 1} in ${source}.`, {
        hint: 'Use an absolute URL, an optional HTTP method followed by a URL, or Katana JSONL.',
      });
    }

    const method = parseMethod(match[1] ?? 'GET', lineSource);
    const urlValue = match[2];
    if (urlValue === undefined) {
      continue;
    }

    const url = parseUrl(urlValue, lineSource);
    requests.push({
      method,
      url,
      headers: {},
      source: lineSource,
    });
  }

  if (requests.length === 0) {
    throw new GatecrashError(`${source} does not contain any URLs.`);
  }

  return requests;
}

export async function loadCapture(path: string): Promise<CapturedRequest[]> {
  const absolutePath = resolve(path);
  let contents: string;
  try {
    contents = await readLimitedUtf8File(absolutePath, {
      label: 'Capture file',
      maximumBytes: CAPTURE_MAXIMUM_BYTES,
    });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new GatecrashError(`Capture file not found: ${path}`, {
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
    } catch {
      if (harExtension) {
        throw new GatecrashError(`Could not parse HAR file: ${path}`, {
          hint: 'Check that the file contains valid HAR JSON.',
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
