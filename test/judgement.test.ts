/**
 * What the tool is willing to say about a pair of responses.
 *
 * Every case here is one the previous classifier got wrong on an ordinary
 * application. A 180-route capture against a target with eight real holes in
 * it produced 188 results to review, of which 172 were two people's own
 * records in the same shape; the loudest thing the tool could say fired on an
 * empty order list and a health check.
 */
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {interruptSignal} from '../src/commands/check.js';
import {compareResponses, findingForRoute, isDiscriminating} from '../src/core/classify.js';
import {parseConfig} from '../src/core/config.js';
import {fingerprintResponse} from '../src/core/fingerprint.js';
import {prepareRoutes, samplePositions} from '../src/core/normalize.js';
import {checkRequests, controlProfile, estimatedRunMs} from '../src/core/run.js';
import type {
  CapturedRequest,
  CompareConfig,
  GatecrashConfig,
  InternalResponse,
  PreparedRoute,
  ProfileConfig,
} from '../src/core/types.js';

const encoder = new TextEncoder();
const compare: CompareConfig = {
  baseline: 'alice',
  against: ['bob'],
  similarityThreshold: 0.92,
  volatileJsonKeys: [],
  control: true,
};
const alice: ProfileConfig = {name: 'alice', level: 10, headers: {}, cookies: {}};
const bob: ProfileConfig = {name: 'bob', level: 10, headers: {}, cookies: {}};

function response(profile: string, status: number, body: string): InternalResponse {
  return fingerprintResponse({
    profile,
    status,
    contentType: 'application/json',
    body: encoder.encode(body),
    durationMs: 1,
    truncated: false,
    volatileJsonKeys: [],
  });
}

const route = {
  id: 'r', reportId: 'route-0001', method: 'GET',
  url: new URL('https://app.example.test/api/orders'),
  path: '/api/orders', pattern: '/api/orders', queryNames: [],
  headers: {}, source: 'test:1',
} as unknown as PreparedRoute;

describe('a response with nothing in it', () => {
  // `{"items":[],"total":0}` is what half the endpoints in a capture return to
  // a fresh test account, and it is byte-identical for every caller alive.
  it.each([
    ['[]', 0],
    ['{}', 0],
    ['{"items":[],"total":0}', 0],
    ['{"ok":true,"enabled":false,"count":0,"next":null}', 0],
  ])('carries no distinguishing content: %s', (body, expected) => {
    const measured = response('alice', 200, body);
    expect(measured.contentBytes).toBe(expected);
    expect(isDiscriminating(measured)).toBe(false);
  });

  it('counts the content of a real record', () => {
    const measured = response('alice', 200, '{"owner":"alice","amount":4800,"items":["A","B"]}');
    expect(measured.contentBytes).toBeGreaterThanOrEqual(16);
    expect(isDiscriminating(measured)).toBe(true);
  });

  it('drops an exact match on an empty collection to low confidence', () => {
    const empty = '{"items":[],"total":0}';
    const comparison = compareResponses(
      response('alice', 200, empty),
      response('bob', 200, empty),
      alice,
      bob,
      compare,
    );
    expect(comparison.outcome).toBe('review');
    expect(comparison.exact).toBe(true);

    const finding = findingForRoute(route, response('alice', 200, empty), [comparison]);
    // The box in the report is reserved for `high`. This case used to reach it.
    expect(finding?.confidence).toBe('low');
    expect(finding?.reason).toContain('carries nothing that would distinguish');
  });

  it('keeps an exact match on a real record at high confidence', () => {
    const record = '{"owner":"alice","balance":4800,"plan":"founder"}';
    const comparison = compareResponses(
      response('alice', 200, record),
      response('bob', 200, record),
      alice,
      bob,
      compare,
    );
    const finding = findingForRoute(route, response('alice', 200, record), [comparison]);
    expect(finding?.confidence).toBe('high');
  });
});

describe('the control session', () => {
  const health = '{"status":"ok"}';

  it('calls a route public when a credential-free session gets the same empty reply', () => {
    const comparison = compareResponses(
      response('alice', 200, health),
      response('bob', 200, health),
      alice,
      bob,
      compare,
      response('control', 200, health),
    );
    expect(comparison.outcome).toBe('public');
    expect(comparison.reason).toContain('no credentials');
  });

  // The same observation means the opposite thing when the body has something
  // in it. Suppressing this would hide the exact bug the demo lab ships.
  it('escalates rather than suppresses when the credential-free session gets real data', () => {
    const record = '{"owner":"alice","export":["A-200","A-201"],"amount":4800}';
    const control = response('control', 200, record);
    const comparison = compareResponses(
      response('alice', 200, record),
      response('bob', 200, '{"owner":"bob","export":[],"amount":0}'),
      alice,
      bob,
      compare,
      control,
    );
    expect(comparison.outcome).not.toBe('public');

    // No challenger produced a review here, and it is still a finding.
    const finding = findingForRoute(route, response('alice', 200, record), [comparison], control);
    expect(finding?.confidence).toBe('high');
    expect(finding?.crossings.map(({challenger}) => challenger)).toEqual(['control']);
    expect(finding?.reason).toContain('carrying no credentials');
  });

  it('carries no headers and no cookies of its own', () => {
    expect(controlProfile.headers).toEqual({});
    expect(controlProfile.cookies).toEqual({});
    expect(controlProfile.level).toBeLessThan(0);
  });

  it('refuses a configured profile that would shadow it', () => {
    expect(() => parseConfig({
      target: {origin: 'https://app.example.test'},
      profiles: {control: {level: 0}, admin: {level: 10}},
    })).toThrowError(/reserved/);
  });

  it('can be turned off', () => {
    const config = parseConfig({
      target: {origin: 'https://app.example.test'},
      profiles: {admin: {level: 10}, member: {level: 1}},
      compare: {control: false},
    });
    expect(config.compare.control).toBe(false);
  });
});

describe('one finding per route', () => {
  it('names every session that got through in a single result', () => {
    const record = '{"owner":"alice","balance":4800,"plan":"founder"}';
    const baseline = response('alice', 200, record);
    const comparisons = ['bob', 'carol', 'dave'].map((name) => compareResponses(
      baseline,
      response(name, 200, record),
      alice,
      {name, level: 1, headers: {}, cookies: {}},
      compare,
    ));

    const finding = findingForRoute(route, baseline, comparisons);
    expect(finding?.crossings).toHaveLength(3);
    expect(finding?.reason).toContain('bob, carol, and dave');
    // The ID is the route ordinal and the baseline, never a URL or a body.
    expect(finding?.id).toMatch(/^GTC-[0-9A-F]{6}$/);
  });

  it('produces nothing when no session got through', () => {
    const baseline = response('alice', 200, '{"owner":"alice","balance":4800}');
    const blocked = compareResponses(baseline, response('bob', 403, '{}'), alice, bob, compare);
    expect(findingForRoute(route, baseline, [blocked])).toBeUndefined();
  });
});

describe('route families', () => {
  it.each([
    [10, 3, [0, 5, 9]],
    [2, 3, [0, 1]],
    [40, 1, [0]],
    [5, 0, [0, 1, 2, 3, 4]],
  ])('spreads %i members across %i picks', (size, keep, expected) => {
    expect(samplePositions(size, keep)).toEqual(expected);
  });

  const capture = (count: number): CapturedRequest[] =>
    Array.from({length: count}, (_, index) => ({
      method: 'GET',
      url: new URL(`https://app.example.test/api/files/${1000 + index}`),
      headers: {},
      source: `test:${index}`,
    }));

  it('sends a few members of a family instead of all of them', () => {
    const prepared = prepareRoutes(
      capture(40),
      'https://app.example.test',
      new Set(['GET']),
      {paths: [], extensions: []},
      3,
    );
    expect(prepared.routes).toHaveLength(3);
    expect(prepared.families).toEqual([
      {method: 'GET', pattern: '/api/files/{int}', matched: 40, replayed: 3},
    ]);
    // Never in silence: what was held back is in the skipped list with a
    // reason, and the count of it reaches the report and the terminal.
    expect(prepared.skipped).toHaveLength(37);
    expect(prepared.skipped.every(({reason}) => reason === 'sampled')).toBe(true);
    expect(prepared.skipped[0]?.detail).toContain('matched 40 routes');
  });

  it('sends every member when sampling is off', () => {
    const prepared = prepareRoutes(
      capture(40),
      'https://app.example.test',
      new Set(['GET']),
      {paths: [], extensions: []},
      0,
    );
    expect(prepared.routes).toHaveLength(40);
    expect(prepared.skipped).toHaveLength(0);
  });

  it('leaves distinct endpoints alone', () => {
    const requests: CapturedRequest[] = ['/api/me', '/api/orders', '/api/teams'].map((path) => ({
      method: 'GET',
      url: new URL(`https://app.example.test${path}`),
      headers: {},
      source: path,
    }));
    const prepared = prepareRoutes(
      requests,
      'https://app.example.test',
      new Set(['GET']),
      {paths: [], extensions: []},
      3,
    );
    expect(prepared.routes).toHaveLength(3);
    expect(prepared.skipped).toHaveLength(0);
  });

  it('keeps capture order in what it does send', () => {
    const prepared = prepareRoutes(
      capture(9),
      'https://app.example.test',
      new Set(['GET']),
      {paths: [], extensions: []},
      3,
    );
    const paths = prepared.routes.map(({path}) => path);
    expect(paths).toEqual([...paths].sort());
  });
});

describe('what a run costs', () => {
  it('is computable before any of it runs', () => {
    // Six hundred routes across three sessions at the default two a second.
    expect(estimatedRunMs(1_800, 2)).toBe(900_000);
    expect(estimatedRunMs(0, 2)).toBe(0);
  });
});

describe('the interrupt handler', () => {
  // Node suppresses the default terminate-on-SIGINT while any listener is
  // registered, so one left behind after the run means the Ctrl-C somebody
  // presses while a long report is printing does nothing at all.
  it('puts the signal back the way it found it', () => {
    const before = process.listenerCount('SIGINT');
    const {release} = interruptSignal();
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    release();
    expect(process.listenerCount('SIGINT')).toBe(before);
    expect(process.listenerCount('SIGTERM')).toBe(0);
  });

  it('releases on the way out of an abort too', () => {
    const before = process.listenerCount('SIGINT');
    const {signal} = interruptSignal();
    process.emit('SIGINT');
    expect(signal.aborted).toBe(true);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});

describe('an interrupted run', () => {
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    server = createServer((request, res) => {
      const body = JSON.stringify({owner: 'alice', balance: 4800, plan: 'founder'});
      res.writeHead(request.headers.authorization === undefined ? 401 : 200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  });

  it('reports what it reached instead of losing the whole run', async () => {
    const config: GatecrashConfig = {
      target: {origin, requestsPerSecond: 100, concurrency: 1, timeoutMs: 2_000, maxResponseBytes: 100_000},
      profiles: [alice, bob],
      compare: {...compare, control: false},
      exclude: {paths: [], extensions: []},
      sample: {perPattern: 0},
    };
    const requests: CapturedRequest[] = Array.from({length: 20}, (_, index) => ({
      method: 'GET',
      url: new URL(`${origin}/api/files/${index}`),
      headers: {},
      source: `test:${index}`,
    }));

    const controller = new AbortController();
    const result = await checkRequests(requests, config, {
      inputLabel: 'interrupt.har',
      allowedMethods: new Set(['GET']),
      save: false,
      signal: controller.signal,
      onProgress: ({stage, completed}) => {
        if (stage === 'replay' && completed >= 6) {
          controller.abort();
        }
      },
    });

    expect(result.interrupted).toBe(true);
    expect(result.report.run.interrupted).toBe(true);
    // Some routes came back, and fewer than the whole plan.
    expect(result.report.summary.routes).toBeGreaterThan(0);
    expect(result.report.summary.routes).toBeLessThan(requests.length);
    // Every route in the report has a complete set of responses behind it.
    for (const reported of result.report.routes) {
      expect(reported.responses).toHaveLength(2);
    }
  });
});
