import {describe, expect, it} from 'vitest';
import {startDemoLab} from '../src/core/demo-lab.js';
import {inspectRequests} from '../src/core/inspect.js';

describe('safe inspection', () => {
  it('previews exact work without exposing headers, bodies, or query values', async () => {
    const lab = await startDemoLab();
    try {
      const inspection = inspectRequests(
        lab.requests,
        lab.config,
        new Set(['GET', 'HEAD', 'OPTIONS']),
        'doorlab capture',
      );

      expect(inspection).toMatchObject({
        captured: 5,
        profiles: 3,
        replays: 9,
        baseline: 'alice',
      });
      expect(inspection.routes).toHaveLength(3);
      expect(inspection.skipped).toHaveLength(2);

      const serialized = JSON.stringify(inspection);
      expect(serialized).not.toContain('x-demo-user');
      expect(serialized).not.toContain('displayName');
      expect(serialized).not.toContain('alice-secret');
    } finally {
      await lab.close();
    }
  });
});
