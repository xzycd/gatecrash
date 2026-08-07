import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {startDemoLab} from '../src/core/demo-lab.js';
import {loadReport, saveReport} from '../src/core/report.js';
import {checkRequests} from '../src/core/run.js';

describe('private reports', () => {
  it('atomically replaces a report with private permissions and no response headers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gatecrash-report-'));
    const destination = join(directory, 'run.json');
    const lab = await startDemoLab();
    try {
      const result = await checkRequests(lab.requests, lab.config, {
        inputLabel: 'doorlab',
        allowedMethods: new Set(['GET', 'HEAD', 'OPTIONS']),
        save: false,
      });
      await writeFile(destination, 'old', {mode: 0o644});
      await saveReport(result.report, destination);

      expect((await stat(destination)).mode & 0o777).toBe(0o600);
      const contents = await readFile(destination, 'utf8');
      expect(contents).not.toContain('contentType');
      expect(contents).not.toContain('application/json');
      expect(contents).not.toContain('x-demo-user');
      expect((await loadReport(destination)).schemaVersion).toBe(3);
    } finally {
      await lab.close();
      await rm(directory, {recursive: true, force: true});
    }
  });
});
