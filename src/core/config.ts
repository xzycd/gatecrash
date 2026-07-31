import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import {GuestlistError} from './errors.js';
import type {
  CompareConfig,
  ExcludeConfig,
  GuestlistConfig,
  ProfileConfig,
  TargetConfig,
} from './types.js';

const DEFAULT_EXCLUDED_EXTENSIONS = [
  'avif',
  'css',
  'eot',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'map',
  'mp3',
  'mp4',
  'otf',
  'pdf',
  'png',
  'svg',
  'ttf',
  'webm',
  'webp',
  'woff',
  'woff2',
];

const DEFAULT_VOLATILE_JSON_KEYS = [
  'csrf',
  'csrfToken',
  'expiresAt',
  'nonce',
  'requestId',
  'timestamp',
  'token',
  'updatedAt',
];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new GuestlistError(`${label} must be a mapping.`);
  }

  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GuestlistError(`${label} must be a non-empty string.`);
  }

  return value;
}

function asNumber(
  value: unknown,
  fallback: number,
  label: string,
  bounds: {minimum: number; maximum: number},
): number {
  const candidate = value === undefined ? fallback : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate < bounds.minimum ||
    candidate > bounds.maximum
  ) {
    throw new GuestlistError(
      `${label} must be between ${bounds.minimum} and ${bounds.maximum}.`,
    );
  }

  return candidate;
}

function asStringArray(value: unknown, fallback: string[], label: string): string[] {
  if (value === undefined) {
    return [...fallback];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new GuestlistError(`${label} must be a list of strings.`);
  }

  return [...value];
}

function expandEnvironment(value: string, label: string, environment: NodeJS.ProcessEnv): string {
  const missing = new Set<string>();
  const expanded = value.replaceAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const replacement = environment[name];
    if (replacement === undefined) {
      missing.add(name);
      return '';
    }

    return replacement;
  });

  if (missing.size > 0) {
    const names = [...missing].sort().join(', ');
    throw new GuestlistError(`Missing environment variable${missing.size === 1 ? '' : 's'}: ${names}.`, {
      hint: `Set ${names} before running Guestlist. The value is used by ${label}.`,
    });
  }

  return expanded;
}

function stringMap(
  value: unknown,
  label: string,
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  const record = asRecord(value, label);
  const entries = Object.entries(record).map(([name, item]) => {
    if (typeof item !== 'string') {
      throw new GuestlistError(`${label}.${name} must be a string.`);
    }

    return [name, expandEnvironment(item, `${label}.${name}`, environment)] as const;
  });

  return Object.fromEntries(entries);
}

function parseTarget(raw: UnknownRecord): TargetConfig {
  const target = asRecord(raw.target, 'target');
  const originValue = asString(target.origin, 'target.origin');
  let parsed: URL;

  try {
    parsed = new URL(originValue);
  } catch {
    throw new GuestlistError('target.origin must be an absolute HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new GuestlistError('target.origin must use HTTP or HTTPS.');
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new GuestlistError('target.origin must contain only the scheme and host.', {
      hint: `Use ${parsed.origin} instead.`,
    });
  }

  return {
    origin: parsed.origin,
    requestsPerSecond: asNumber(
      target.requests_per_second,
      2,
      'target.requests_per_second',
      {minimum: 0.1, maximum: 100},
    ),
    concurrency: Math.floor(
      asNumber(target.concurrency, 4, 'target.concurrency', {minimum: 1, maximum: 32}),
    ),
    timeoutMs: Math.floor(
      asNumber(target.timeout_ms, 10_000, 'target.timeout_ms', {
        minimum: 100,
        maximum: 120_000,
      }),
    ),
    maxResponseBytes: Math.floor(
      asNumber(target.max_response_bytes, 1_000_000, 'target.max_response_bytes', {
        minimum: 1_024,
        maximum: 10_000_000,
      }),
    ),
  };
}

function parseProfiles(
  raw: UnknownRecord,
  environment: NodeJS.ProcessEnv,
): ProfileConfig[] {
  const source = asRecord(raw.profiles, 'profiles');
  const profiles = Object.entries(source).map(([name, value]) => {
    const profile = asRecord(value, `profiles.${name}`);
    return {
      name,
      level: asNumber(profile.level, 0, `profiles.${name}.level`, {
        minimum: 0,
        maximum: 1_000,
      }),
      headers: stringMap(profile.headers, `profiles.${name}.headers`, environment),
      cookies: stringMap(profile.cookies, `profiles.${name}.cookies`, environment),
    };
  });

  if (profiles.length < 2) {
    throw new GuestlistError('profiles must define at least two sessions to compare.');
  }

  return profiles;
}

function parseCompare(raw: UnknownRecord, profiles: ProfileConfig[]): CompareConfig {
  const source = raw.compare === undefined ? {} : asRecord(raw.compare, 'compare');
  const profileNames = profiles.map((profile) => profile.name);
  const defaultBaseline = [...profiles].sort((left, right) => right.level - left.level)[0]?.name;
  if (defaultBaseline === undefined) {
    throw new GuestlistError('No baseline profile is available.');
  }

  const baseline = source.baseline === undefined
    ? defaultBaseline
    : asString(source.baseline, 'compare.baseline');

  if (!profileNames.includes(baseline)) {
    throw new GuestlistError(`compare.baseline references unknown profile "${baseline}".`);
  }

  const defaultAgainst = profileNames.filter((name) => name !== baseline);
  const against = asStringArray(source.against, defaultAgainst, 'compare.against');
  const unknown = against.filter((name) => !profileNames.includes(name));
  if (unknown.length > 0) {
    throw new GuestlistError(`compare.against references unknown profile "${unknown[0]}".`);
  }

  if (against.includes(baseline)) {
    throw new GuestlistError('compare.against cannot contain the baseline profile.');
  }

  if (against.length === 0) {
    throw new GuestlistError('compare.against must contain at least one profile.');
  }

  if (new Set(against).size !== against.length) {
    throw new GuestlistError('compare.against cannot contain the same profile twice.');
  }

  return {
    baseline,
    against,
    similarityThreshold: asNumber(
      source.similarity_threshold,
      0.92,
      'compare.similarity_threshold',
      {minimum: 0.5, maximum: 1},
    ),
    volatileJsonKeys: asStringArray(
      source.volatile_json_keys,
      DEFAULT_VOLATILE_JSON_KEYS,
      'compare.volatile_json_keys',
    ),
  };
}

function parseExclude(raw: UnknownRecord): ExcludeConfig {
  const source = raw.exclude === undefined ? {} : asRecord(raw.exclude, 'exclude');
  return {
    paths: asStringArray(source.paths, [], 'exclude.paths'),
    extensions: asStringArray(
      source.extensions,
      DEFAULT_EXCLUDED_EXTENSIONS,
      'exclude.extensions',
    ).map((extension) => extension.toLowerCase().replace(/^\./, '')),
  };
}

export function parseConfig(
  value: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): GuestlistConfig {
  const raw = asRecord(value, 'config');
  const target = parseTarget(raw);
  const profiles = parseProfiles(raw, environment);
  return {
    target,
    profiles,
    compare: parseCompare(raw, profiles),
    exclude: parseExclude(raw),
  };
}

export async function loadConfig(
  path = 'guestlist.yml',
  environment: NodeJS.ProcessEnv = process.env,
): Promise<GuestlistConfig> {
  const absolutePath = resolve(path);
  let contents: string;

  try {
    contents = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      throw new GuestlistError(`Config file not found: ${path}`, {
        hint: 'Run guestlist init, or pass a file with --config.',
      });
    }

    throw error;
  }

  try {
    return parseConfig(parse(contents), environment);
  } catch (error) {
    if (error instanceof GuestlistError) {
      throw error;
    }

    throw new GuestlistError(`Could not parse ${path}.`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

export function configTemplate(): string {
  return `# Guestlist reads secrets from the environment. It never writes them to a report.
target:
  origin: https://app.example.test
  requests_per_second: 2
  concurrency: 4
  timeout_ms: 10000

profiles:
  admin:
    level: 100
    headers:
      Authorization: "Bearer \${ADMIN_TOKEN}"

  member:
    level: 10
    headers:
      Authorization: "Bearer \${MEMBER_TOKEN}"

  anonymous:
    level: 0

compare:
  baseline: admin
  against: [member, anonymous]
  similarity_threshold: 0.92

exclude:
  paths:
    - /health
    - /assets/**
`;
}
