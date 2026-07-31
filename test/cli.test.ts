import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
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
  it('has useful command help', async () => {
    const {stdout} = await run(['--help']);
    expect(stdout).toContain('check [options] <capture>');
    expect(stdout).toContain('demo [options]');
    expect(stdout).toContain('explain [options] <finding>');
  });

  it('prints a machine-readable demo report without terminal noise', async () => {
    const {stdout, stderr} = await run(['demo', '--format', 'json', '--no-save']);
    expect(stderr).toBe('');
    const report = JSON.parse(stdout) as {schemaVersion: number; summary: {reviews: number}};
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.reviews).toBe(2);
  });
});
