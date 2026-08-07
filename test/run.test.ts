import {describe, expect, it} from 'vitest';
import {startDemoLab} from '../src/core/demo-lab.js';
import {assertReplayLimit, checkRequests, MAXIMUM_REPLAYS} from '../src/core/run.js';
import type {RunStage} from '../src/core/types.js';

describe('complete check', () => {
  it('caps a replay plan before any network work starts', () => {
    expect(() => assertReplayLimit(MAXIMUM_REPLAYS)).not.toThrow();
    expect(() => assertReplayLimit(MAXIMUM_REPLAYS + 1)).toThrowError(/Replay plan is too large/);
  });

  it('finds the two planted authorization mistakes without persisting bodies', async () => {
    const lab = await startDemoLab();
    try {
      const stages = new Set<RunStage>();
      const result = await checkRequests(lab.requests, lab.config, {
        inputLabel: 'test doorlab',
        allowedMethods: new Set(['GET', 'HEAD', 'OPTIONS']),
        save: false,
        onProgress: ({stage}) => stages.add(stage),
      });

      expect(result.report.summary).toMatchObject({routes: 3, findings: 2, skipped: 2});
      expect(result.report.findings.map(({path, confidence, crossings}) =>
        [path, confidence, crossings.map(({challenger}) => challenger)])).toEqual([
        // Reached by a session carrying nothing at all, which is the strongest
        // thing the tool can say and why this one sorts above the other.
        ['/api/member/export', 'high', ['control', 'anonymous']],
        ['/api/account/alice', 'high', ['bob']],
      ]);
      expect(stages).toEqual(new Set(['capture', 'scope', 'replay', 'compare', 'report']));

      const serialized = JSON.stringify(result.report);
      expect(serialized).not.toContain('founder');
      expect(serialized).not.toContain('A-200');
      expect(serialized).not.toContain('x-demo-user');
      expect(serialized).not.toContain('4800');
    } finally {
      await lab.close();
    }
  });
});
