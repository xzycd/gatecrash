import {describe, expect, it} from 'vitest';
import {ASCII, Ink, UNICODE, visible, wrap} from '../src/ui/ink.js';
import {frame} from '../src/ui/motion.js';
import {
  headline,
  renderError,
  renderFinding,
  renderInspection,
  renderReport,
  renderWelcome,
} from '../src/ui/view.js';
import {fit, render} from '../src/brand.js';
import {GatecrashError} from '../src/core/errors.js';
import type {CheckResult, Finding, InspectionResult, RunProgress} from '../src/core/types.js';

const finding: Finding = {
  id: 'GTC-A1B2C3',
  routeId: 'route-0001',
  method: 'GET',
  path: '/api/account/alice',
  baseline: 'admin',
  baselineStatus: 200,
  crossings: [{challenger: 'anonymous', status: 200, similarity: 1, exact: true}],
  similarity: 1,
  exact: true,
  confidence: 'high',
  reason: 'anonymous received the same successful response as admin.',
  evidence: [
    'admin returned HTTP 200.',
    'anonymous returned HTTP 200.',
    'The normalized response bodies are identical.',
  ],
};

const result: CheckResult = {
  reportPath: '/tmp/report.json',
  report: {
    schemaVersion: 3,
    toolVersion: '0.6.0',
    run: {
      id: 'run-1',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 84,
      input: 'fixture.har',
      targetOrigin: 'https://app.example.test',
    },
    config: {
      baseline: 'admin',
      profiles: [{name: 'admin', level: 100}, {name: 'anonymous', level: 0}],
      control: false,
      allowedMethods: ['GET'],
      similarityThreshold: 0.92,
      samplePerPattern: 3,
    },
    summary: {
      captured: 2, skipped: 0, sampled: 0,
      routes: 2, findings: 1, high: 1, medium: 0, low: 0,
      replays: 4, comparisons: 2, reviews: 1, publicResults: 0,
      blocked: 1, changed: 0, errors: 0,
    },
    routes: [
      {
        id: 'route-0001',
        method: 'GET',
        path: '/api/account/alice',
        pattern: '/api/account/alice',
        queryNames: [],
        responses: [
          {profile: 'admin', status: 200, bytes: 24, kind: 'json', truncated: false, durationMs: 10},
          {profile: 'anonymous', status: 200, bytes: 24, kind: 'json', truncated: false, durationMs: 11},
        ],
        comparisons: [{
          baseline: 'admin', challenger: 'anonymous', baselineStatus: 200, challengerStatus: 200,
          similarity: 1, exact: true, outcome: 'review',
          reason: 'anonymous received the same successful response as admin.',
        }],
      },
      {
        id: 'route-0002',
        method: 'GET',
        path: '/api/admin/settings',
        pattern: '/api/admin/settings',
        queryNames: [],
        responses: [
          {profile: 'admin', status: 200, bytes: 90, kind: 'json', truncated: false, durationMs: 9},
          {profile: 'anonymous', status: 403, bytes: 12, kind: 'json', truncated: false, durationMs: 8},
        ],
        comparisons: [{
          baseline: 'admin', challenger: 'anonymous', baselineStatus: 200, challengerStatus: 403,
          similarity: 0.1, exact: false, outcome: 'blocked', reason: 'anonymous received 403.',
        }],
      },
    ],
    findings: [finding],
    skipped: [],
  },
};

const plain = new Ink(0, false, UNICODE);
const ascii = new Ink(0, false, ASCII);
const colour = new Ink(24, false, UNICODE);

function widest(text: string): number {
  return Math.max(...text.split('\n').map(visible));
}

// Wrapping decides where the line breaks fall, so an assertion about wording
// should not also be an assertion about the width it was rendered at.
function flat(text: string): string {
  return text.replaceAll(/\s+/g, ' ');
}

describe('the check report', () => {
  it('leads with the header, the alarm, and the sentence that names the worst thing', () => {
    const output = renderReport(result, plain, 100);
    const lines = output.split('\n').filter((line) => line !== '');
    expect(lines[0]).toContain('gatecrash');
    expect(lines[0]).toContain('https://app.example.test');
    expect(output).toContain('EXACT MATCH');
    expect(flat(output)).toContain(
      '1 route returned data belonging to admin to a session that should not have had it.',
    );
  });

  // The panel is the one thing on the screen that is not a judgement call. If
  // everything were boxed then nothing would be.
  it('boxes nothing when no response came back identical', () => {
    const softened = structuredClone(result);
    softened.report.findings = [{...finding, exact: false, similarity: 0.95, confidence: 'medium'}];
    softened.report.summary.high = 0;
    softened.report.summary.medium = 1;
    expect(renderReport(softened, plain, 100)).not.toContain('EXACT MATCH');
    expect(renderReport(softened, plain, 100)).toContain('95%');
  });

  // An empty collection is byte-identical for every caller alive, so a copy of
  // it reaching a second session is not the thing the box is reserved for.
  it('leaves the box shut for an exact match on a response with nothing in it', () => {
    const weak = structuredClone(result);
    weak.report.findings = [{...finding, confidence: 'low'}];
    weak.report.summary.high = 0;
    weak.report.summary.low = 1;
    const output = renderReport(weak, plain, 100);
    expect(output).not.toContain('EXACT MATCH');
    expect(flat(output)).toContain('too empty to prove anything either way');
  });

  it('says so plainly when nothing crossed', () => {
    const clear = structuredClone(result);
    clear.report.findings = [];
    clear.report.summary = {
      ...clear.report.summary, findings: 0, high: 0, medium: 0, low: 0, reviews: 0,
    };
    const output = renderReport(clear, plain, 100);
    expect(output).toContain('no crossings');
    expect(output).not.toContain('EXACT MATCH');
  });

  it('never runs past the width it was given, at any width', () => {
    for (const span of [60, 72, 80, 100, 120]) {
      expect(widest(renderReport(result, plain, span))).toBeLessThanOrEqual(span);
    }
  });

  it('keeps the same width once the escapes are discounted', () => {
    expect(widest(renderReport(result, colour, 100))).toBeLessThanOrEqual(100);
  });

  // Wide terminals read across a row. Narrow terminals cannot, so the same
  // information stacks instead of folding.
  it('uses profile columns when wide and stacked tracks when narrow', () => {
    expect(renderReport(result, plain, 100)).toContain('admin/base');
    expect(renderReport(result, plain, 62)).not.toContain('admin/base');
    expect(renderReport(result, plain, 62)).toContain('/api/account/alice');
  });

  it('drops to ASCII when the terminal cannot promise UTF-8', () => {
    const output = renderReport(result, ascii, 100);
    expect(output).not.toMatch(/[▌│├└─╭╮╰╯█░●✓≠…›]/u);
    expect(output).toContain('|');
  });

  // Colour is allowed to support a label and never to carry one.
  it('keeps every outcome distinguishable with no colour at all', () => {
    const output = renderReport(result, plain, 100);
    expect(output).toContain('200 ●');
    expect(output).toContain('200 !');
    expect(output).toContain('403 ✓');
    expect(output).toContain('review');
  });

  it('explains the exit code only when one is going to be set', () => {
    expect(renderReport(result, plain, 100, 'high')).toContain('exit 2');
    expect(renderReport(result, plain, 100)).not.toContain('exit 2');
  });

  // The gate has to be able to pass, or a team deletes it. A run holding only
  // weak matches is not a failing run at `--fail-on high`.
  it('holds the gate shut only for findings at or above the confidence asked for', () => {
    const weak = structuredClone(result);
    weak.report.findings = [{...finding, confidence: 'low'}];
    weak.report.summary.high = 0;
    weak.report.summary.low = 1;
    expect(renderReport(weak, plain, 100, 'high')).not.toContain('exit 2');
    expect(renderReport(weak, plain, 100, 'low')).toContain('exit 2');
  });

  it('names the report it saved and the command that opens a result', () => {
    const output = renderReport(result, plain, 100);
    expect(output).toContain('gatecrash explain GTC-A1B2C3');
    expect(output).toContain('/tmp/report.json');
  });

  it('says how many results it held back rather than truncating in silence', () => {
    const many = structuredClone(result);
    many.report.findings = Array.from({length: 9}, (_, index) => ({
      ...finding,
      id: `GTC-00000${index}`,
    }));
    expect(renderReport(many, plain, 100)).toContain('3 more in the saved report');
  });
});

describe('headline', () => {
  it('reaches for the failure count when nothing matched', () => {
    const failing = structuredClone(result.report);
    failing.findings = [];
    failing.summary = {...failing.summary, high: 0, medium: 0, low: 0, reviews: 0, errors: 3};
    expect(headline(failing)).toContain('3 requests failed');
  });

  it('says nothing when there is nothing to say', () => {
    const clean = structuredClone(result.report);
    clean.findings = [];
    clean.summary = {...clean.summary, high: 0, medium: 0, low: 0, reviews: 0, errors: 0};
    expect(headline(clean)).toBe('');
  });

  // It counted exact findings and called them sessions, so a five-route run
  // against two sessions opened by claiming five sessions had got through.
  it('counts routes and says routes', () => {
    const many = structuredClone(result.report);
    many.config.profiles = [{name: 'admin', level: 100}, {name: 'anonymous', level: 0}];
    many.summary = {...many.summary, high: 5, medium: 0, low: 0};
    expect(headline(many)).toContain('5 routes');
    expect(headline(many)).not.toContain('session received');
    expect(headline(many)).not.toContain('5 sessions');
  });
});

describe('the other views', () => {
  const inspection: InspectionResult = {
    input: 'session.har',
    targetOrigin: 'https://app.example.test',
    baseline: 'admin',
    challengers: ['member', 'anonymous'],
    control: true,
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    captured: 4,
    routes: [{
      id: 'route-0001',
      method: 'GET',
      path: '/api/account/alice',
      pattern: '/api/account/alice',
      queryNames: [],
    }],
    families: [{
      method: 'GET',
      pattern: '/api/account/alice',
      matched: 1,
      replayed: 1,
    }],
    skipped: [{
      id: 'route-0002',
      method: 'POST',
      path: '/api/profile',
      reason: 'unsafe-method',
      detail: 'POST requires --allow-method POST.',
    }],
    profiles: 3,
    replays: 3,
    estimatedMs: 1_500,
  };

  it('promises nothing was sent, and says what would be', () => {
    const output = renderInspection(inspection, plain, 100);
    expect(output).toContain('nothing was sent');
    expect(output).toContain('3 requests planned');
    expect(output).toContain('1 skipped: 1 unsafe-method');
    expect(output).toContain('gatecrash check session.har');
    expect(widest(output)).toBeLessThanOrEqual(100);
  });

  // The way to find out a run took a quarter of an hour used to be to start it.
  it('says what the plan costs in requests and in time before any of it runs', () => {
    const slow = {...inspection, replays: 1_800, estimatedMs: 900_000};
    const output = renderInspection(slow, plain, 100);
    expect(output).toContain('1800 requests');
    expect(output).toContain('900 s');
  });

  it('names the control session and how many routes sampling holds back', () => {
    const folded: InspectionResult = {
      ...inspection,
      families: [{method: 'GET', pattern: '/api/files/{int}', matched: 40, replayed: 3}],
      skipped: Array.from({length: 37}, (_, index) => ({
        id: `route-${index}`,
        method: 'GET',
        path: `/api/files/${index}`,
        reason: 'sampled' as const,
        detail: 'GET /api/files/{int} matched 40 routes; 3 were replayed.',
      })),
    };
    const output = renderInspection(folded, plain, 100);
    expect(output).toContain('/api/files/{int}');
    expect(output).toContain('×40');
    expect(output).toContain('3 sampled');
    expect(flat(output)).toContain('37 routes are held back');
    expect(flat(output)).toContain('sample.per_pattern: 0');
    expect(output).toContain('control');
    expect(widest(output)).toBeLessThanOrEqual(100);
  });

  it('shows the evidence and refuses to call it a verdict', () => {
    const output = renderFinding(finding, '/tmp/report.json', plain, 100);
    expect(output).toContain('GTC-A1B2C3');
    expect(output).toContain('admin 200 → anonymous 200');
    expect(output).toContain('The normalized response bodies are identical.');
    expect(flat(output)).toContain('a result is a lead: verify it against the access policy');
    expect(widest(output)).toBeLessThanOrEqual(100);
  });

  it('offers the fix next to the error rather than underneath it', () => {
    const output = renderError(
      new GatecrashError('Config file not found: gatecrash.yml', {hint: 'Run gatecrash init.'}),
      plain,
      100,
    );
    expect(output).toContain('Config file not found');
    expect(output).toContain('fix');
    expect(output).toContain('Run gatecrash init.');
  });

  it('leads the welcome with the mark and the first command to try', () => {
    const output = renderWelcome(plain, 100, {depth: 0, animate: false, room: 100});
    expect(output).toContain('gatecrash demo');
    expect(output).toContain('gatecrash --help');
    expect(output).toContain('Same request. Wrong session.');
  });

  it('keeps the welcome inside the terminal at every width', () => {
    for (const span of [60, 70, 80, 100, 120]) {
      const output = renderWelcome(plain, span, {depth: 0, animate: false, room: span});
      expect(widest(output)).toBeLessThanOrEqual(span);
    }
  });

  /**
   * A layout constant that happens to be right at a hundred columns is a bug
   * at sixty. The fixtures above are comfortable ones; these are not, and
   * every value in them is something a real capture can produce. Five of the
   * lines this covers were running past the edge, two of them since before
   * this file existed: the summary counts and the exit line were never handed
   * a terminal width at all.
   */
  it('keeps every view inside the terminal at every width, on hostile input', () => {
    const path = '/api/v2/organizations/{uuid}/members/{uuid}/permissions/effective';
    const wide: Finding = {
      ...finding,
      path,
      confidence: 'high',
      crossings: ['control', 'anonymous', 'member', 'auditor', 'contractor'].map((challenger) => ({
        challenger, status: 200, similarity: 1, exact: true,
      })),
      reason: "A session carrying no credentials received administrator's response in full. "
        + 'control, anonymous, member, auditor, and contractor reached this route.',
    };
    const crowded = structuredClone(result);
    crowded.report.run.targetOrigin = 'https://really-quite-long-hostname.internal.example.test';
    crowded.report.config.baseline = 'administrator';
    crowded.report.config.profiles = [
      {name: 'administrator', level: 100}, {name: 'member', level: 10},
      {name: 'anonymous', level: 0}, {name: 'control', level: -1},
    ];
    // Every count non-zero at once, which is the widest the summary ever gets.
    crowded.report.summary = {
      captured: 900, skipped: 868, sampled: 866, routes: 32, findings: 12,
      high: 8, medium: 3, low: 1, replays: 128, comparisons: 64, reviews: 40,
      publicResults: 4, blocked: 18, changed: 2, errors: 2,
    };
    crowded.report.findings = Array.from({length: 12}, (_, index) => ({
      ...wide, id: `GTC-00000${index}`,
    }));
    crowded.reportPath = '/home/somebody/work/client-engagement/.gatecrash/runs/2026-08-06.json';

    const folded: InspectionResult = {
      ...inspection,
      input: 'a-rather-long-capture-filename-for-a-big-crawl.har',
      targetOrigin: crowded.report.run.targetOrigin,
      baseline: 'administrator',
      challengers: ['member', 'anonymous', 'auditor'],
      allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PATCH', 'DELETE'],
      families: [{method: 'GET', pattern: path, matched: 220, replayed: 3}],
      skipped: [{
        id: 'route-0003', method: 'GET', path: '/api/v2/notifications/1000',
        reason: 'sampled', detail: 'matched 220 routes; 3 were replayed.',
      }],
      replays: 160,
      estimatedMs: 900_000,
    };

    for (const ink of [plain, ascii, colour]) {
      for (const span of [60, 61, 62, 63, 66, 72, 77, 78, 80, 92, 100, 110, 120]) {
        for (const failOn of [undefined, 'high', 'low'] as const) {
          for (const interrupted of [false, true]) {
            const output = renderReport({...crowded, interrupted}, ink, span, failOn);
            expect(widest(output), `report ${span} ${failOn} ${interrupted}`)
              .toBeLessThanOrEqual(span);
          }
        }
        expect(widest(renderInspection(folded, ink, span)), `inspect ${span}`)
          .toBeLessThanOrEqual(span);
        expect(widest(renderFinding(wide, folded.input, ink, span)), `finding ${span}`)
          .toBeLessThanOrEqual(span);
      }
    }
  });
});

describe('the mark', () => {
  it('steps down through four sizes rather than wrapping', () => {
    expect(fit(120)).toEqual([2, true]);
    expect(fit(80)).toEqual([2, false]);
    expect(fit(50)).toEqual([1, false]);
    expect(fit(20)).toEqual([0, false]);
  });

  it('draws every letter of its own name and fits the width it claims', () => {
    const rows = render('gatecrash', 2);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
    expect(rows[0]?.length).toBeLessThanOrEqual(76 - 2);
  });
});

describe('the live line', () => {
  const progress: RunProgress = {
    stage: 'replay',
    completed: 3,
    total: 9,
    detail: 'anonymous · GET /api/account/alice',
    captured: 3,
    routes: 3,
    skipped: 0,
    profiles: 3,
    replays: 9,
    baseline: 'admin',
    challengers: ['anonymous'],
  };

  it('reports real progress and stays inside the terminal', () => {
    const line = frame(progress, 1_200, plain, 4, 80);
    expect(line).toContain('replaying');
    expect(line).toContain('3/9');
    expect(visible(line)).toBeLessThanOrEqual(80);
  });

  // A line redrawn in place has to be erasable. Anything past the edge wraps,
  // and the erase then leaves a stripe of dead text behind it.
  it('trims itself rather than wrapping on a narrow terminal', () => {
    expect(visible(frame(progress, 1_200, plain, 4, 40))).toBeLessThanOrEqual(40);
  });

  it('shows no count for a stage that has nothing to count', () => {
    expect(frame({...progress, stage: 'scope'}, 10, plain, 1, 80)).not.toContain('3/9');
  });
});

describe('wrapping', () => {
  it('breaks a word that cannot fit rather than letting it overhang', () => {
    expect(wrap('x'.repeat(30), 10).every((line) => line.length <= 10)).toBe(true);
  });

  it('keeps short text on one line', () => {
    expect(wrap('two words', 40)).toEqual(['two words']);
  });
});
