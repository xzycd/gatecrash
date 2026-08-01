// Every case here is something a target server, a capture file, or a saved
// report can contain. Each one failed before the fix it names.
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {parseHar} from '../src/core/capture.js';
import {fingerprintResponse} from '../src/core/fingerprint.js';
import {displayPath, matchesPath} from '../src/core/normalize.js';
import {reportMarkdown} from '../src/core/report.js';
import {installCommand} from '../src/commands/update.js';
import {readLimitedUtf8File} from '../src/utils/files.js';
import {terminalText} from '../src/utils/security.js';
import type {GatecrashReport} from '../src/core/types.js';

function fingerprint(body: string, contentType: string) {
  return fingerprintResponse({
    profile: 'anonymous',
    status: 200,
    contentType,
    body: new TextEncoder().encode(body),
    durationMs: 1,
    truncated: false,
    volatileJsonKeys: [],
  });
}

describe('responses built to break the tool', () => {
  // A recursive visitor overflowed the stack here and took the whole run with
  // it, so any target could stop a scan by nesting its markup. Fifteen
  // thousand levels is under the tag budget, so this still parses as HTML.
  it('fingerprints deeply nested HTML without exhausting the stack', () => {
    const response = fingerprint(`${'<div>'.repeat(15_000)}payload`, 'text/html');
    expect(response.kind).toBe('html');
    expect(response.structure.has('div')).toBe(true);
  });

  // parse5 is quadratic in nesting depth, so this document is not a crash but
  // a bill: ten seconds of CPU, once per profile, for every route.
  it('falls back to text rather than parsing a tag bomb', () => {
    const started = performance.now();
    const response = fingerprint(`${'<div>'.repeat(60_000)}payload`, 'text/html');
    expect(response.kind).toBe('text');
    expect(response.normalized).toContain('payload');
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('still parses a large page with ordinary nesting as HTML', () => {
    const page = `<html><body>${'<div>x</div>'.repeat(1_000)}</body></html>`;
    expect(fingerprint(page, 'text/html').kind).toBe('html');
  });

  it('fingerprints deeply nested JSON without exhausting the stack', () => {
    const body = `${'['.repeat(60_000)}1${']'.repeat(60_000)}`;
    const response = fingerprint(body, 'application/json');
    expect(response.kind).toBe('json');
    expect(response.normalized).toContain('<deep>');
  });

  it('still reads nesting at the depth a real page uses', () => {
    const response = fingerprint(`${'<div>'.repeat(200)}visible text`, 'text/html');
    expect(response.normalized).toContain('visible text');
  });

  it('compares two capped responses consistently', () => {
    const body = `${'['.repeat(60_000)}1${']'.repeat(60_000)}`;
    expect(fingerprint(body, 'application/json').normalized).toBe(
      fingerprint(body, 'application/json').normalized,
    );
  });
});

describe('report privacy', () => {
  // A query part with no `=` used to be recorded as if the whole token were a
  // parameter name, which put a session value straight into a saved report.
  it('does not record a valueless query part as a query name', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnop';
    const {path, queryNames} = displayPath(new URL(`https://app.example.test/r?${token}`));
    expect(queryNames).not.toContain(token);
    expect(path).not.toContain(token);
  });

  it('keeps a short valueless flag readable', () => {
    expect(displayPath(new URL('https://app.example.test/r?debug')).queryNames).toEqual(['debug']);
  });
});

describe('terminal safety', () => {
  it('removes escape, line, carriage-return, C1, and bidi controls', () => {
    expect(terminalText('safe[31m\nnext\rover‮end')).toBe('safe[31mnextoverend');
  });

  // Overrides were covered; the marks that reorder a line without an override
  // were not, so `/api/admin` could be made to read as something else.
  it('removes bidi marks, separators, and zero-width characters', () => {
    expect(terminalText('/api/‏admin ​﻿؜/x')).toBe('/api/admin/x');
  });

  it('caps a very long value instead of printing all of it', () => {
    expect(terminalText('a'.repeat(9_000)).length).toBeLessThan(3_000);
  });
});

describe('markdown reports', () => {
  const report = {
    schemaVersion: 2,
    toolVersion: '0.0.0',
    run: {id: 'r', startedAt: '', durationMs: 1, input: 'c.har', targetOrigin: 'https://app.example.test'},
    config: {baseline: 'admin', profiles: [], allowedMethods: ['GET'], similarityThreshold: 0.92},
    summary: {captured: 1, routes: 1, replays: 2, reviews: 1, blocked: 0, changed: 0, errors: 0, skipped: 0},
    routes: [],
    findings: [{
      id: 'GTC-A1B2C3',
      routeId: 'route-0001',
      method: 'GET',
      // A path is attacker-shaped input, and this one used to survive into the
      // report as a working link pointing wherever the capture said.
      path: '/a/[click here](https://evil.example.test)',
      baseline: 'admin',
      challenger: 'anonymous',
      baselineStatus: 200,
      challengerStatus: 200,
      similarity: 1,
      exact: true,
      confidence: 'high',
      reason: 'anonymous received the same successful response as admin.',
      evidence: ['![img](https://evil.example.test/pixel)'],
    }],
    skipped: [],
  } as unknown as GatecrashReport;

  it('escapes link and image syntax out of attacker-shaped values', () => {
    const markdown = reportMarkdown(report);
    expect(markdown).not.toContain('[click here](https://evil.example.test)');
    expect(markdown).not.toContain('![img](https://evil.example.test/pixel)');
    expect(markdown).toContain('\\[click here\\]\\(https://evil.example.test\\)');
  });
});

describe('capture limits', () => {
  it('refuses a capture entry carrying an oversized upload', () => {
    const har = {
      log: {
        entries: [{
          request: {
            method: 'POST',
            url: 'https://app.example.test/upload',
            postData: {text: 'x'.repeat(8_000_001)},
          },
        }],
      },
    };
    expect(() => parseHar(har)).toThrow(/larger than/);
  });
});

describe('exclusion patterns', () => {
  // `?` was a regex quantifier here, so this pattern excluded `/admi/x` and
  // did not exclude the path the operator wrote down.
  it('treats ? in an exclude pattern as a literal character', () => {
    expect(matchesPath('/admi/x', ['/admin?/**'])).toBe(false);
    expect(matchesPath('/admin?/x', ['/admin?/**'])).toBe(true);
  });
});

describe('bounded file reads', () => {
  it('reports a file that outgrew its budget rather than truncating it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gatecrash-'));
    const path = join(directory, 'capture.txt');
    await writeFile(path, 'x'.repeat(100));
    await expect(readLimitedUtf8File(path, {label: 'Capture file', maximumBytes: 50}))
      .rejects.toThrow(/too large/);
  });

  it('reads a file that fits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gatecrash-'));
    const path = join(directory, 'capture.txt');
    await writeFile(path, 'https://app.example.test/a\n');
    await expect(readLimitedUtf8File(path, {label: 'Capture file', maximumBytes: 4_096}))
      .resolves.toBe('https://app.example.test/a\n');
  });
});

describe('update install command', () => {
  it('installs only the verified local archive with scripts disabled', () => {
    const linuxArchive = '/tmp/gatecrash-update-a1b2/xzycd-gatecrash-1.2.3.tgz';
    expect(installCommand(linuxArchive, 'linux')).toEqual({
      command: 'npm',
      args: [
        'install',
        '--global',
        '--ignore-scripts',
        linuxArchive,
      ],
    });
    const windowsArchive = 'C:\\Temp\\gatecrash-update-a1b2\\xzycd-gatecrash-1.2.3.tgz';
    expect(installCommand(windowsArchive, 'win32').args).toEqual([
      '/d', '/s', '/v:off', '/c', 'npm',
      'install',
      '--global',
      '--ignore-scripts',
      windowsArchive,
    ]);
  });

  it('refuses unexpected names and shell metacharacters', () => {
    expect(() => installCommand('/tmp/gatecrash-1.2.3.tgz && curl evil.test', 'linux'))
      .toThrow(/unrecognised/);
    expect(() => installCommand(
      'C:\\Temp%PATH%\\xzycd-gatecrash-1.2.3.tgz',
      'win32',
    )).toThrow(/unsafe archive path/);
  });
});
