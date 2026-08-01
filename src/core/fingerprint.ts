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
    return 'html';
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
    .match(/[\p{L}\p{N}_@.-]{2,}/gu);
  return new Set(words ?? []);
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

type HtmlNode = DefaultTreeAdapterMap['node'];

function htmlSignals(value: string): {text: string; tags: Set<string>} {
  const document = parse(value);
  const text: string[] = [];
  const tags = new Set<string>();
  const hiddenTags = new Set(['script', 'style', 'svg', 'template']);

  const visit = (node: HtmlNode, hidden: boolean): void => {
    const tagName = 'tagName' in node ? node.tagName.toLowerCase() : undefined;
    const nextHidden = hidden || tagName !== undefined && hiddenTags.has(tagName);
    if (tagName !== undefined) {
      tags.add(tagName);
    }
    if (node.nodeName === '#text' && 'value' in node && !nextHidden) {
      text.push(node.value);
    }
    if ('childNodes' in node) {
      for (const child of node.childNodes) {
        visit(child, nextHidden);
      }
    }
  };

  visit(document, false);
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
): {normalized: string; structure: Set<string>; tokens: Set<string>} {
  const structure = new Set<string>();

  const clean = (item: unknown, path: string): unknown => {
    structure.add(`${path || '/'}:${scalarType(item)}`);

    if (Array.isArray(item)) {
      return item.map((child) => clean(child, `${path}[]`));
    }

    if (typeof item === 'object' && item !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) {
        const nextPath = `${path}/${key}`;
        if (volatileKeys.has(key.toLowerCase())) {
          structure.add(`${nextPath}:volatile`);
          result[key] = '<volatile>';
        } else {
          result[key] = clean(child, nextPath);
        }
      }
      return result;
    }

    return item;
  };

  const normalized = JSON.stringify(clean(value, ''));
  return {normalized, structure, tokens: tokenize(normalized)};
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

  if (kind === 'json') {
    const volatileKeys = new Set(input.volatileJsonKeys.map((key) => key.toLowerCase()));
    const json = normalizeJson(JSON.parse(text) as unknown, volatileKeys);
    normalized = json.normalized;
    structure = json.structure;
    tokens = json.tokens;
  } else if (kind === 'html') {
    const html = htmlSignals(text);
    normalized = html.text;
    tokens = tokenize(normalized);
    structure = html.tags;
  } else if (kind === 'text') {
    normalized = normalizeText(text);
    tokens = tokenize(normalized);
  } else if (kind === 'binary') {
    normalized = binaryFingerprint(input.body);
    tokens = new Set([normalized]);
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
