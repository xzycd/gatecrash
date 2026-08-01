import {describe, expect, it} from 'vitest';
import {
  compareVersions,
  findRelease,
  normalizeVersion,
  type ReleaseFetcher,
} from '../src/core/update.js';

const version = '0.6.0';
const tag = `v${version}`;
const archiveName = `xzycd-gatecrash-${version}.tgz`;
const archiveUrl = `https://github.com/xzycd/gatecrash/releases/download/${tag}/${archiveName}`;
const checksumsUrl = `https://github.com/xzycd/gatecrash/releases/download/${tag}/SHA256SUMS`;

function releaseJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: tag,
    html_url: `https://github.com/xzycd/gatecrash/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      {name: archiveName, browser_download_url: archiveUrl, size: 7},
      {name: 'SHA256SUMS', browser_download_url: checksumsUrl, size: 100},
    ],
    ...overrides,
  };
}

describe('GitHub updater', () => {
  it('normalizes and compares stable versions', () => {
    expect(normalizeVersion('v0.6.0')).toBe('0.6.0');
    expect(compareVersions('0.10.0', '0.6.9')).toBe(1);
    expect(compareVersions('0.6.0', '0.6.0')).toBe(0);
    expect(compareVersions('0.5.9', '0.6.0')).toBe(-1);
    expect(() => normalizeVersion('0.6.0-beta.1')).toThrowError(/Invalid release version/);
  });

  it('loads a specific stable release only from trusted GitHub locations', async () => {
    let requested = '';
    const fetcher: ReleaseFetcher = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify(releaseJson()), {
        headers: {'content-type': 'application/json'},
      });
    };
    const release = await findRelease('v0.6.0', fetcher);
    expect(requested).toBe('https://api.github.com/repos/xzycd/gatecrash/releases/tags/v0.6.0');
    expect(release).toMatchObject({version: '0.6.0', tag: 'v0.6.0'});

    const untrusted: ReleaseFetcher = async () => new Response(JSON.stringify(releaseJson({
      html_url: 'https://example.test/xzycd/gatecrash/releases/tag/v0.6.0',
    })));
    await expect(findRelease(undefined, untrusted)).rejects.toThrowError(/untrusted release page/);
  });

  it('rejects releases with missing or oversized package assets', async () => {
    const missingArchive: ReleaseFetcher = async () => new Response(JSON.stringify(releaseJson({
      assets: [{name: 'SHA256SUMS', browser_download_url: checksumsUrl, size: 100}],
    })));
    await expect(findRelease(undefined, missingArchive)).rejects.toThrowError(/does not contain/);

    const oversizedArchive: ReleaseFetcher = async () => new Response(JSON.stringify(releaseJson({
      assets: [
        {name: archiveName, browser_download_url: archiveUrl, size: 50_000_001},
        {name: 'SHA256SUMS', browser_download_url: checksumsUrl, size: 100},
      ],
    })));
    await expect(findRelease(undefined, oversizedArchive)).rejects.toThrowError(/unexpectedly large/);
  });
});
