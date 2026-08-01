import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, 'src/cli.tsx');

async function run(arguments_: string[]): Promise<{stdout: string; stderr: string}> {
  return exec(process.execPath, ['--import', 'tsx', cli, ...arguments_], {
    cwd: root,
    env: {...process.env, NO_COLOR: '1'},
  });
}

describe('CLI', () => {
  it('turns an empty invocation into a useful first step', async () => {
    const {stdout} = await run([]);
    expect(stdout).toContain('gatecrash  Same request. Wrong session.');
    expect(stdout).toContain('gatecrash demo');
    expect(stdout).toContain('gatecrash inspect capture.har');
  });

  it('has useful command help', async () => {
    const {stdout} = await run(['--help']);
    expect(stdout).toContain('check [options] <capture>');
    expect(stdout).toContain('demo [options]');
    expect(stdout).toContain('explain [options] <finding>');
    expect(stdout).toContain('inspect [options] <capture>');
  });

  it('prints a machine-readable demo report without terminal noise', async () => {
    const {stdout, stderr} = await run(['demo', '--format', 'json', '--no-save']);
    expect(stderr).toBe('');
    const report = JSON.parse(stdout) as {schemaVersion: number; summary: {reviews: number}};
    expect(report.schemaVersion).toBe(2);
    expect(report.summary.reviews).toBe(2);
  });

  it('inspects a capture without requiring profile secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gatecrash-cli-'));
    const config = join(directory, 'gatecrash.yml');
    const capture = join(directory, 'routes.txt');
    try {
      await writeFile(config, [
        'target:',
        '  origin: https://app.example.test',
        'profiles:',
        '  admin:',
        '    level: 100',
        '    headers:',
        '      Authorization: "Bearer ${MISSING_ADMIN_TOKEN}"',
        '  member:',
        '    level: 10',
        '    headers:',
        '      Authorization: "Bearer ${MISSING_MEMBER_TOKEN}"',
        '',
      ].join('\n'));
      await writeFile(capture, 'https://app.example.test/api/me?token=private\n');

      const {stdout, stderr} = await run([
        'inspect',
        capture,
        '--config',
        config,
        '--format',
        'json',
      ]);
      expect(stderr).toBe('');
      const inspection = JSON.parse(stdout) as {replays: number; routes: Array<{path: string}>};
      expect(inspection.replays).toBe(2);
      expect(inspection.routes[0]?.path).toBe('/api/me?token');
      expect(stdout).not.toContain('private');
      expect(stdout).not.toContain('MISSING_ADMIN_TOKEN');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
