import {GatecrashError} from './errors.js';

const REPOSITORY = 'xzycd/gatecrash';
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const MAXIMUM_ARCHIVE_BYTES = 50_000_000;
const MAXIMUM_CHECKSUM_BYTES = 100_000;
const VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type ReleaseFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubAsset[];
}

export interface UpdateRelease {
  version: string;
  tag: string;
  pageUrl: string;
  archive: GitHubAsset;
  checksums: GitHubAsset;
}

function githubHeaders(): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'gatecrash-updater',
    'x-github-api-version': '2022-11-28',
  };
}

export function normalizeVersion(value: string): string {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) {
    throw new GatecrashError(`Invalid release version: ${value}`, {
      hint: 'Use a stable version such as 0.6.0 or v0.6.0.',
    });
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new GatecrashError(`Invalid release version: ${value}`, {
      hint: 'Each version number must be a safe non-negative integer.',
    });
  }
  return parts.join('.');
}

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left).split('.').map(Number);
  const rightParts = normalizeVersion(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

function assetFrom(value: unknown): GitHubAsset | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.browser_download_url !== 'string' ||
    typeof candidate.size !== 'number' ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size < 0
  ) {
    return undefined;
  }
  return {
    name: candidate.name,
    browser_download_url: candidate.browser_download_url,
    size: candidate.size,
  };
}

function releaseFrom(value: unknown): GitHubRelease {
  if (typeof value !== 'object' || value === null) {
    throw new GatecrashError('GitHub returned an invalid release response.');
  }
  const candidate = value as Record<string, unknown>;
  const assets = Array.isArray(candidate.assets)
    ? candidate.assets.map(assetFrom).filter((asset) => asset !== undefined)
    : [];
  if (
    typeof candidate.tag_name !== 'string' ||
    typeof candidate.html_url !== 'string' ||
    typeof candidate.draft !== 'boolean' ||
    typeof candidate.prerelease !== 'boolean'
  ) {
    throw new GatecrashError('GitHub returned an invalid release response.');
  }
  return {
    tag_name: candidate.tag_name,
    html_url: candidate.html_url,
    draft: candidate.draft,
    prerelease: candidate.prerelease,
    assets,
  };
}

function trustedReleasePage(url: string, tag: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://github.com' &&
      parsed.pathname === `/${REPOSITORY}/releases/tag/${tag}`;
  } catch {
    return false;
  }
}

function trustedReleaseAsset(asset: GitHubAsset, tag: string): boolean {
  try {
    const parsed = new URL(asset.browser_download_url);
    return parsed.origin === 'https://github.com' &&
      parsed.pathname === `/${REPOSITORY}/releases/download/${tag}/${asset.name}`;
  } catch {
    return false;
  }
}

function assertTrustedRelease(release: UpdateRelease): void {
  const version = normalizeVersion(release.version);
  const tag = `v${version}`;
  const archiveName = `xzycd-gatecrash-${version}.tgz`;
  if (
    release.version !== version ||
    release.tag !== tag ||
    release.archive.name !== archiveName ||
    release.checksums.name !== 'SHA256SUMS' ||
    !trustedReleasePage(release.pageUrl, tag) ||
    !trustedReleaseAsset(release.archive, tag) ||
    !trustedReleaseAsset(release.checksums, tag)
  ) {
    throw new GatecrashError('The update does not point to a trusted Gatecrash release.');
  }
  if (
    release.archive.size > MAXIMUM_ARCHIVE_BYTES ||
    release.checksums.size > MAXIMUM_CHECKSUM_BYTES
  ) {
    throw new GatecrashError(`Release ${tag} contains an unexpectedly large update asset.`);
  }
}

function usableRelease(value: unknown): UpdateRelease {
  const release = releaseFrom(value);
  const version = normalizeVersion(release.tag_name);
  const tag = `v${version}`;
  if (release.draft || release.prerelease || release.tag_name !== tag) {
    throw new GatecrashError('The selected GitHub release is not a stable Gatecrash release.');
  }
  if (!trustedReleasePage(release.html_url, tag)) {
    throw new GatecrashError('GitHub returned an untrusted release page URL.');
  }

  const archiveName = `xzycd-gatecrash-${version}.tgz`;
  const archive = release.assets.find((asset) => asset.name === archiveName);
  const checksums = release.assets.find((asset) => asset.name === 'SHA256SUMS');
  if (archive === undefined || checksums === undefined) {
    throw new GatecrashError(`Release ${tag} does not contain an installable Gatecrash archive.`, {
      hint: `The release must include ${archiveName} and SHA256SUMS.`,
    });
  }
  if (
    !trustedReleaseAsset(archive, tag) ||
    !trustedReleaseAsset(checksums, tag)
  ) {
    throw new GatecrashError('GitHub returned an untrusted release asset URL.');
  }
  if (archive.size > MAXIMUM_ARCHIVE_BYTES || checksums.size > MAXIMUM_CHECKSUM_BYTES) {
    throw new GatecrashError(`Release ${tag} contains an unexpectedly large update asset.`);
  }
  const update = {version, tag, pageUrl: release.html_url, archive, checksums};
  assertTrustedRelease(update);
  return update;
}

async function requestRelease(
  endpoint: string,
  fetcher: ReleaseFetcher,
  missingVersion?: string,
): Promise<UpdateRelease> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: githubHeaders(),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GatecrashError('Could not reach GitHub to check for Gatecrash updates.', {
      hint: 'Check the network connection and try again.',
    });
  }
  if (response.status === 404 && missingVersion !== undefined) {
    throw new GatecrashError(`Gatecrash ${missingVersion} was not found on GitHub.`, {
      hint: `See https://github.com/${REPOSITORY}/releases for available versions.`,
    });
  }
  if (!response.ok) {
    throw new GatecrashError(`GitHub update check failed with HTTP ${response.status}.`, {
      hint: response.status === 403
        ? 'GitHub may be rate limiting this network. Try again later.'
        : 'Try again later.',
    });
  }
  try {
    return usableRelease(await response.json());
  } catch (error) {
    if (error instanceof GatecrashError) {
      throw error;
    }
    throw new GatecrashError('GitHub returned an invalid release response.');
  }
}

export async function findRelease(
  requestedVersion: string | undefined,
  fetcher: ReleaseFetcher = fetch,
): Promise<UpdateRelease> {
  if (requestedVersion === undefined) {
    return requestRelease(`${RELEASES_API}/latest`, fetcher);
  }
  const version = normalizeVersion(requestedVersion);
  return requestRelease(`${RELEASES_API}/tags/v${version}`, fetcher, version);
}
