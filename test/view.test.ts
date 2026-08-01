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
  challenger: 'anonymous',
  baselineStatus: 200,
  challengerStatus: 200,
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
    schemaVersion: 2,
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
      allowedMethods: ['GET'],
      similarityThreshold: 0.92,
    },
    summary: {
      captured: 2, routes: 2, replays: 4, reviews: 1,
      blocked: 1, changed: 0, errors: 0, skipped: 0,
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
    expect(output).toContain('1 session received a response it should have had to earn.');
  });

  // The panel is the one thing on the screen that is not a judgement call. If
  // everything were boxed then nothing would be.
  it('boxes nothing when no response came back identical', () => {
    const softened = structuredClone(result);
    softened.report.findings = [{...finding, exact: false, similarity: 0.95, confidence: 'medium'}];
    expect(renderReport(softened, plain, 100)).not.toContain('EXACT MATCH');
    expect(renderReport(softened, plain, 100)).toContain('95%');
  });

  it('says so plainly when nothing crossed', () => {
    const clear = structuredClone(result);
    clear.report.findings = [];
    clear.report.summary.reviews = 0;
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
    expect(renderReport(result, plain, 100, true)).toContain('exit 2');
    expect(renderReport(result, plain, 100, false)).not.toContain('exit 2');
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
    failing.summary.reviews = 0;
    failing.summary.errors = 3;
    expect(headline(failing)).toContain('3 requests failed');
  });

  it('says nothing when there is nothing to say', () => {
    const clean = structuredClone(result.report);
    clean.findings = [];
    clean.summary.reviews = 0;
    clean.summary.errors = 0;
    expect(headline(clean)).toBe('');
  });
});

describe('the other views', () => {
  const inspection: InspectionResult = {
    input: 'session.har',
    targetOrigin: 'https://app.example.test',
    baseline: 'admin',
    challengers: ['member', 'anonymous'],
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    captured: 4,
    routes: [{
      id: 'route-0001',
      method: 'GET',
      path: '/api/account/alice',
      pattern: '/api/account/alice',
      queryNames: [],
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
  };

  it('promises nothing was sent, and says what would be', () => {
    const output = renderInspection(inspection, plain, 100);
    expect(output).toContain('nothing was sent');
    expect(output).toContain('3 requests planned');
    expect(output).toContain('1 skipped: 1 unsafe-method');
    expect(output).toContain('gatecrash check session.har');
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
