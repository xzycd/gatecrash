import {describe, expect, it} from 'vitest';
import {startDemoLab} from '../src/core/demo-lab.js';
import {checkRequests} from '../src/core/run.js';
import type {RunStage} from '../src/core/types.js';

describe('complete check', () => {
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

      expect(result.report.summary).toMatchObject({routes: 3, reviews: 2, skipped: 2});
      expect(result.report.findings.map(({challenger, path}) => [challenger, path])).toEqual([
        ['bob', '/api/account/alice'],
        ['anonymous', '/api/member/export'],
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
