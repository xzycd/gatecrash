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
        // alice, bob, anonymous, and the credential-free control session.
        profiles: 4,
        replays: 12,
        baseline: 'alice',
        control: true,
      });
      expect(inspection.routes).toHaveLength(3);
      expect(inspection.skipped).toHaveLength(2);
      expect(inspection.families).toHaveLength(3);
      // Three routes across four sessions at forty a second.
      expect(inspection.estimatedMs).toBe(300);

      const serialized = JSON.stringify(inspection);
      expect(serialized).not.toContain('x-demo-user');
      expect(serialized).not.toContain('displayName');
      expect(serialized).not.toContain('alice-secret');
    } finally {
      await lab.close();
    }
  });
});
