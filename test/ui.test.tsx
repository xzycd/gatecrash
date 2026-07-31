import {render} from 'ink-testing-library';
import {describe, expect, it} from 'vitest';
import type {CheckResult} from '../src/core/types.js';
import {ReportView} from '../src/ui/components.js';

const result: CheckResult = {
  reportPath: '/tmp/report.json',
  report: {
    schemaVersion: 1,
    toolVersion: '0.1.0',
    run: {
      id: 'run-1',
      startedAt: '2026-08-01T00:00:00.000Z',
      durationMs: 84,
      input: 'fixture.har',
      targetOrigin: 'https://app.example.test',
    },
    config: {
      baseline: 'admin',
      profiles: [{name: 'admin', level: 100}, {name: 'member', level: 10}],
      allowedMethods: ['GET'],
      similarityThreshold: 0.92,
    },
    summary: {captured: 1, routes: 1, replays: 2, reviews: 1, blocked: 0, changed: 0, errors: 0, skipped: 0},
    routes: [{
      id: 'route-1',
      method: 'GET',
      path: '/api/admin/users',
      pattern: '/api/admin/users',
      queryNames: [],
      responses: [
        {profile: 'admin', status: 200, bytes: 24, kind: 'json', truncated: false, durationMs: 10},
        {profile: 'member', status: 200, bytes: 24, kind: 'json', truncated: false, durationMs: 11},
      ],
      comparisons: [{
        baseline: 'admin', challenger: 'member', baselineStatus: 200, challengerStatus: 200,
        similarity: 1, exact: true, outcome: 'review', reason: 'member received the same response.',
      }],
    }],
    findings: [{
      id: 'GST-ABC123', routeId: 'route-1', method: 'GET', path: '/api/admin/users',
      baseline: 'admin', challenger: 'member', baselineStatus: 200, challengerStatus: 200,
      similarity: 1, exact: true, confidence: 'high', reason: 'member received the same response.',
      evidence: ['admin returned HTTP 200.', 'member returned HTTP 200.', 'The bodies match.'],
    }],
    skipped: [],
  },
};

describe('terminal report', () => {
  it('keeps the access matrix, evidence, and next action in one frame', () => {
    const view = render(<ReportView result={result} />);
    const output = view.lastFrame() ?? '';
    expect(output).toContain('guestlist');
    expect(output).toContain('access map');
    expect(output).toContain('/api/admin/users');
    expect(output).toContain('GST-ABC123');
    expect(output).toContain('guestlist explain GST-ABC123');
    view.unmount();
  });
});
