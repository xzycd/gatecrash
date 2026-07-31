import {describe, expect, it} from 'vitest';
import {compareResponses} from '../src/core/classify.js';
import {fingerprintResponse, responseSimilarity} from '../src/core/fingerprint.js';
import type {CompareConfig, ProfileConfig} from '../src/core/types.js';

const encoder = new TextEncoder();
const compare: CompareConfig = {
  baseline: 'alice',
  against: ['bob'],
  similarityThreshold: 0.92,
  volatileJsonKeys: ['requestId'],
};
const alice: ProfileConfig = {name: 'alice', level: 10, headers: {}, cookies: {}};
const bob: ProfileConfig = {name: 'bob', level: 10, headers: {}, cookies: {}};

function response(profile: string, status: number, body: string) {
  return fingerprintResponse({
    profile,
    status,
    contentType: 'application/json',
    body: encoder.encode(body),
    durationMs: 2,
    truncated: false,
    volatileJsonKeys: compare.volatileJsonKeys,
  });
}

function htmlResponse(profile: string, body: string) {
  return fingerprintResponse({
    profile,
    status: 200,
    contentType: 'text/html',
    body: encoder.encode(body),
    durationMs: 2,
    truncated: false,
    volatileJsonKeys: [],
  });
}

describe('response fingerprints', () => {
  it('removes configured volatile JSON values', () => {
    const left = response('alice', 200, '{"user":"alice","requestId":"one"}');
    const right = response('bob', 200, '{"user":"alice","requestId":"two"}');
    expect(responseSimilarity(left, right)).toBe(1);
  });

  it('marks an exact successful peer response for review', () => {
    const left = response('alice', 200, '{"account":"alice"}');
    const right = response('bob', 200, '{"account":"alice"}');
    expect(compareResponses(left, right, alice, bob, compare)).toMatchObject({
      outcome: 'review',
      exact: true,
      similarity: 1,
    });
  });

  it('recognizes a blocked challenger', () => {
    const left = response('alice', 200, '{"account":"alice"}');
    const right = response('bob', 403, '{"error":"forbidden"}');
    expect(compareResponses(left, right, alice, bob, compare).outcome).toBe('blocked');
  });

  it('does not treat same-shaped personal responses as identical', () => {
    const left = response('alice', 200, '{"username":"alice","workspace":"alice-space"}');
    const right = response('bob', 200, '{"username":"bob","workspace":"bob-space"}');
    const result = compareResponses(left, right, alice, bob, compare);
    expect(result.outcome).toBe('changed');
    expect(result.similarity).toBeLessThan(compare.similarityThreshold);
  });

  it('does not call two empty bodies an exact body match', () => {
    const left = response('alice', 204, '');
    const right = response('bob', 204, '');
    const result = compareResponses(left, right, alice, bob, compare);
    expect(result).toMatchObject({outcome: 'review', exact: false, similarity: 1});
  });

  it('uses parsed visible HTML text and ignores executable content', () => {
    const left = htmlResponse('alice', '<main>Alice &amp; team<script>secretOne()</script></main>');
    const right = htmlResponse('bob', '<main>Alice &amp; team<script>secretTwo()</script></main>');
    expect(left.normalized).toBe('Alice & team');
    expect(responseSimilarity(left, right)).toBe(1);
  });
});
