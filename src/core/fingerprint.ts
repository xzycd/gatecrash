import {createHash} from 'node:crypto';
import {parse, type DefaultTreeAdapterMap} from 'parse5';
import type {BodyKind, InternalResponse, ResponseRecord} from './types.js';

interface FingerprintInput {
  profile: string;
  status: number;
  contentType: string;
  body: Uint8Array;
  durationMs: number;
  truncated: boolean;
  volatileJsonKeys: string[];
}

// Everything below this line is walking a document that a target server chose
// the shape of. None of these bounds change what a well-behaved response
// compares to; they exist so that a response built to be hostile costs a
// bounded amount of stack, heap, and time.
//
// Both sides of a comparison are fingerprinted by the same code with the same
// limits, so a truncated fingerprint still compares deterministically against
// another truncated fingerprint. A limit changes the score, never the verdict
// procedure.

// Deeper than any API response and shallower than the call stack. A JSON
// subtree past this depth is folded to one marker rather than walked, because
// rebuilding the value is naturally recursive and a cap is the cheapest way to
// bound it.
const MAXIMUM_JSON_DEPTH = 128;
// HTML gets a far looser bound because its walk carries an explicit stack and
// does not need protecting from itself. Real pages reach forty or fifty levels
// and a framework can go further, so anything tight here would quietly change
// what a legitimate comparison sees.
const MAXIMUM_HTML_DEPTH = 4_096;
// parse5 builds a tree in time quadratic in nesting depth, and depth can never
// exceed the number of tags, so counting `<` bounds the work before any of it
// starts. Measured on the default 1 MB response budget: a 500 KB page nested
// sixty deep parses in 15 ms, while 195 KB of nested `<div>` takes 4.6 s and
// 300 KB takes ten. That is a target choosing how long the tool spends on it,
// once per profile, for every route.
//
// The count is of `<` rather than of elements on purpose. Anything smarter has
// to model which end tags HTML lets you leave out, and every tag left out of
// the model becomes the tag an attacker nests with instead. Counting the
// character over-counts on comments and stray text, which only ever means
// falling back sooner.
const MAXIMUM_HTML_TAGS = 20_000;
// A structure set is a fingerprint, not an index. Past this it has stopped
// discriminating between responses and started being a memory bill.
const MAXIMUM_STRUCTURE_ENTRIES = 20_000;
const MAXIMUM_TOKENS = 20_000;
const DEEP_MARKER = '<deep>';
const VOLATILE_MARKER = '<volatile>';

/**
 * How many bytes of a value could distinguish one session's data from
 * another's.
 *
 * `{"items":[],"total":0}` is what a fresh account gets from half the
 * endpoints in a capture, and it is byte-identical for every caller alive. It
 * used to reach the operator as the loudest thing the tool can say. Nothing
 * here scores it: an empty string, a zero, a null, and a boolean can carry no
 * identity, and neither can the markers this module substitutes in.
 */
function contentWeight(value: unknown): number {
  if (typeof value === 'string') {
    return value === '' || value === DEEP_MARKER || value === VOLATILE_MARKER
      ? 0
      : JSON.stringify(value).length;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return String(value).length;
  }
  return 0;
}

function boundedAdd(target: Set<string>, value: string, limit: number): void {
  if (target.size < limit) {
    target.add(value);
  }
}

function countTagOpenings(value: string, limit = MAXIMUM_HTML_TAGS): number {
  let count = 0;
  let index = value.indexOf('<');
  while (index !== -1 && count <= limit) {
    count += 1;
    index = value.indexOf('<', index + 1);
  }
  return count;
}

function bodyKind(contentType: string, text: string, byteLength: number): BodyKind {
  if (byteLength === 0) {
    return 'empty';
  }

  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes('json') || /^[\s\n\r]*(?:\{|\[)/.test(text)) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      // A server can label broken JSON as JSON. Compare it as text instead.
    }
  }

  if (normalizedType.includes('html') || /<html|<!doctype html/i.test(text)) {
    // A document too tangled to parse cheaply is still compared, just on its
    // visible text rather than its tag structure. Both sides of a comparison
    // fall back on the same rule, so the verdict stays deterministic.
    return countTagOpenings(text) > MAXIMUM_HTML_TAGS ? 'text' : 'html';
  }

  if (
    normalizedType.startsWith('text/') ||
    normalizedType.includes('xml') ||
    normalizedType.includes('javascript') ||
    normalizedType === ''
  ) {
    return 'text';
  }

  return 'binary';
}

function tokenize(value: string): Set<string> {
  const words = value
    .toLowerCase()
    .replaceAll(/https?:\/\/[^\s"'<>]+/g, '<url>')
    .matchAll(/[\p{L}\p{N}_@.-]{2,}/gu);
  const tokens = new Set<string>();
  for (const [word] of words) {
    if (tokens.size >= MAXIMUM_TOKENS) {
      break;
    }
    tokens.add(word);
  }
  return tokens;
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

type HtmlNode = DefaultTreeAdapterMap['node'];

// parse5 builds its tree iteratively, so it will happily hand back a document
// nested a hundred thousand elements deep. Walking that with a recursive
// visitor overflows the stack and takes the whole run down with it, which is a
// crash any target can trigger with `'<div>' * 200000`. The walk carries its
// own stack instead.
function htmlSignals(value: string): {text: string; tags: Set<string>} {
  const document = parse(value);
  const text: string[] = [];
  const tags = new Set<string>();
  const hiddenTags = new Set(['script', 'style', 'svg', 'template']);
  const pending: Array<{node: HtmlNode; hidden: boolean; depth: number}> = [
    {node: document, hidden: false, depth: 0},
  ];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }

    const {node, depth} = current;
    const tagName = 'tagName' in node ? node.tagName.toLowerCase() : undefined;
    const hidden = current.hidden || tagName !== undefined && hiddenTags.has(tagName);
    if (tagName !== undefined) {
      boundedAdd(tags, tagName, MAXIMUM_STRUCTURE_ENTRIES);
    }
    if (node.nodeName === '#text' && 'value' in node && !hidden && text.length < MAXIMUM_TOKENS) {
      text.push(node.value);
    }
    if (depth < MAXIMUM_HTML_DEPTH && 'childNodes' in node) {
      // Reversed so the explicit stack still visits siblings left to right,
      // which is what keeps the extracted text in document order.
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child !== undefined) {
          pending.push({node: child, hidden, depth: depth + 1});
        }
      }
    }
  }

  return {text: normalizeText(text.join(' ')), tags};
}

function scalarType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function normalizeJson(
  value: unknown,
  volatileKeys: Set<string>,
): {normalized: string; structure: Set<string>; tokens: Set<string>; contentBytes: number} {
  const structure = new Set<string>();
  let contentBytes = 0;

  const clean = (item: unknown, path: string, depth: number): unknown => {
    boundedAdd(structure, `${path || '/'}:${scalarType(item)}`, MAXIMUM_STRUCTURE_ENTRIES);

    // A response can nest as deep as it likes, and rebuilding it is recursive.
    // Past the limit the subtree collapses to one marker, identically on both
    // sides of a comparison, so the run survives a document written to
    // overflow the stack. Without this, `'[' * 200000` from a target is a
    // crash rather than a fingerprint.
    if (depth >= MAXIMUM_JSON_DEPTH) {
      boundedAdd(structure, `${path || '/'}:deep`, MAXIMUM_STRUCTURE_ENTRIES);
      return DEEP_MARKER;
    }

    if (Array.isArray(item)) {
      return item.map((child) => clean(child, `${path}[]`, depth + 1));
    }

    if (typeof item === 'object' && item !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) {
        const nextPath = `${path}/${key}`;
        if (volatileKeys.has(key.toLowerCase())) {
          boundedAdd(structure, `${nextPath}:volatile`, MAXIMUM_STRUCTURE_ENTRIES);
          result[key] = VOLATILE_MARKER;
        } else {
          result[key] = clean(child, nextPath, depth + 1);
        }
      }
      return result;
    }

    contentBytes += contentWeight(item);
    return item;
  };

  const normalized = JSON.stringify(clean(value, '', 0));
  return {normalized, structure, tokens: tokenize(normalized), contentBytes};
}

function binaryFingerprint(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

export function fingerprintResponse(input: FingerprintInput): InternalResponse {
  const text = new TextDecoder('utf8', {fatal: false}).decode(input.body);
  const kind = bodyKind(input.contentType, text, input.body.byteLength);
  let normalized: string;
  let structure = new Set<string>();
  let tokens = new Set<string>();
  let contentBytes = 0;

  if (kind === 'json') {
    const volatileKeys = new Set(input.volatileJsonKeys.map((key) => key.toLowerCase()));
    const json = normalizeJson(JSON.parse(text) as unknown, volatileKeys);
    normalized = json.normalized;
    structure = json.structure;
    tokens = json.tokens;
    contentBytes = json.contentBytes;
  } else if (kind === 'html') {
    const html = htmlSignals(text);
    normalized = html.text;
    tokens = tokenize(normalized);
    structure = html.tags;
    contentBytes = normalized.length;
  } else if (kind === 'text') {
    normalized = normalizeText(text);
    tokens = tokenize(normalized);
    contentBytes = normalized.length;
  } else if (kind === 'binary') {
    normalized = binaryFingerprint(input.body);
    tokens = new Set([normalized]);
    // The digest is a fixed 64 characters whatever it summarises, so the body
    // itself is what says whether there was anything in it to summarise.
    contentBytes = input.body.byteLength;
  } else {
    normalized = '';
  }

  return {
    profile: input.profile,
    status: input.status,
    bytes: input.body.byteLength,
    kind,
    truncated: input.truncated,
    durationMs: input.durationMs,
    normalized,
    structure,
    tokens,
    contentBytes,
  };
}

export function errorResponse(profile: string, message: string, durationMs: number): InternalResponse {
  return {
    profile,
    bytes: 0,
    kind: 'empty',
    truncated: false,
    durationMs,
    error: message,
    normalized: '',
    structure: new Set(),
    tokens: new Set(),
    contentBytes: 0,
  };
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}

export function responseSimilarity(left: InternalResponse, right: InternalResponse): number {
  if (left.error !== undefined || right.error !== undefined || left.kind !== right.kind) {
    return 0;
  }

  if (left.normalized === right.normalized) {
    return 1;
  }

  if (left.kind === 'json') {
    return 0.6 * jaccard(left.structure, right.structure) + 0.4 * jaccard(left.tokens, right.tokens);
  }

  if (left.kind === 'html') {
    return 0.25 * jaccard(left.structure, right.structure) + 0.75 * jaccard(left.tokens, right.tokens);
  }

  return jaccard(left.tokens, right.tokens);
}

export function publicResponse(response: InternalResponse): ResponseRecord {
  const {
    profile,
    status,
    bytes,
    kind,
    truncated,
    durationMs,
    error,
  } = response;
  return {
    profile,
    ...(status === undefined ? {} : {status}),
    bytes,
    kind,
    truncated,
    durationMs,
    ...(error === undefined ? {} : {error}),
  };
}
