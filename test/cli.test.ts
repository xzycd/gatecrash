import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, 'src/cli.ts');

async function run(
  arguments_: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<{stdout: string; stderr: string}> {
  return exec(process.execPath, ['--import', 'tsx', cli, ...arguments_], {
    cwd: root,
    env: {...process.env, NO_COLOR: '1', ...environment},
  });
}

describe('CLI', () => {
  it('turns an empty invocation into a useful first step', async () => {
    const {stdout} = await run([]);
    // The block mark is the wordmark, so the word itself is not in the text.
    expect(stdout).toContain('█');
    expect(stdout).toContain('Same request. Wrong session.');
    expect(stdout).toContain('gatecrash demo');
    expect(stdout).toContain('gatecrash inspect capture.har');
  });

  it('has useful command help', async () => {
    const {stdout} = await run(['--help']);
    expect(stdout).toContain('check [options] <capture>');
    expect(stdout).toContain('demo [options]');
    expect(stdout).toContain('explain [options] <finding>');
    expect(stdout).toContain('inspect [options] <capture>');
    expect(stdout).toContain('update [options] [version]');
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

  it('runs a real file-based check against a live target', async () => {
    const server = createServer((request, response) => {
      const authorization = request.headers.authorization;
      response.setHeader('content-type', 'application/json');
      if (authorization === 'Bearer admin-token' || authorization === 'Bearer member-token') {
        response.statusCode = 200;
        response.end(JSON.stringify({account: 'admin', plan: 'internal'}));
        return;
      }
      response.statusCode = 401;
      response.end(JSON.stringify({error: 'unauthorized'}));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const directory = await mkdtemp(join(tmpdir(), 'gatecrash-real-cli-'));
    const config = join(directory, 'gatecrash.yml');
    const capture = join(directory, 'routes.txt');
    try {
      await writeFile(config, [
        'target:',
        `  origin: ${origin}`,
        '  requests_per_second: 100',
        '  concurrency: 3',
        'profiles:',
        '  admin:',
        '    level: 100',
        '    headers:',
        '      Authorization: "Bearer ${REAL_ADMIN_TOKEN}"',
        '  member:',
        '    level: 10',
        '    headers:',
        '      Authorization: "Bearer ${REAL_MEMBER_TOKEN}"',
        '  anonymous:',
        '    level: 0',
        'compare:',
        '  baseline: admin',
        '  against: [member, anonymous]',
        '',
      ].join('\n'));
      await writeFile(capture, `${origin}/api/account/admin?trace=private-value\n`);

      const {stdout, stderr} = await run([
        'check',
        capture,
        '--config',
        config,
        '--format',
        'json',
        '--no-save',
      ], {
        REAL_ADMIN_TOKEN: 'admin-token',
        REAL_MEMBER_TOKEN: 'member-token',
      });
      expect(stderr).toBe('');
      const report = JSON.parse(stdout) as {
        summary: {replays: number; reviews: number; blocked: number};
        findings: Array<{challenger: string; path: string}>;
      };
      expect(report.summary).toMatchObject({replays: 3, reviews: 1, blocked: 1});
      expect(report.findings).toEqual([{
        challenger: 'member',
        path: '/api/account/admin?trace',
        id: expect.any(String),
        routeId: expect.any(String),
        method: 'GET',
        confidence: 'high',
        baseline: 'admin',
        baselineStatus: 200,
        challengerStatus: 200,
        similarity: 1,
        exact: true,
        reason: expect.any(String),
        evidence: expect.any(Array),
      }]);
      expect(stdout).not.toContain('private-value');
      expect(stdout).not.toContain('admin-token');
      expect(stdout).not.toContain('member-token');
    } finally {
      await rm(directory, {recursive: true, force: true});
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
});
