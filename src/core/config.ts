import {resolve} from 'node:path';
import {parse} from 'yaml';
import {hasErrorCode, readLimitedUtf8File} from '../utils/files.js';
import {containsRequestControl} from '../utils/security.js';
import {GatecrashError} from './errors.js';
import type {
  CompareConfig,
  ExcludeConfig,
  GatecrashConfig,
  ProfileConfig,
  SampleConfig,
  TargetConfig,
} from './types.js';

const CONFIG_MAXIMUM_BYTES = 1_000_000;
const MAXIMUM_PROFILES = 64;
const MAXIMUM_PROFILE_ENTRIES = 128;
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
// Gatecrash runs a session of its own under this name, so a configured profile
// sharing it would silently replace the run's only credential-free reference.
export const CONTROL_PROFILE = 'control';
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const FORBIDDEN_PROFILE_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

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

interface ParseConfigOptions {
  resolveEnvironment?: boolean;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new GatecrashError(`${label} must be a mapping.`);
  }

  return value;
}

function allowKeys(record: UnknownRecord, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) {
    throw new GatecrashError(`${label}.${unknown} is not a supported setting.`);
  }
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GatecrashError(`${label} must be a non-empty string.`);
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
    throw new GatecrashError(
      `${label} must be between ${bounds.minimum} and ${bounds.maximum}.`,
    );
  }

  return candidate;
}

function asBoolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'boolean') {
    throw new GatecrashError(`${label} must be true or false.`);
  }

  return value;
}

function asStringArray(value: unknown, fallback: string[], label: string): string[] {
  if (value === undefined) {
    return [...fallback];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new GatecrashError(`${label} must be a list of strings.`);
  }
  if (value.length > 1_000 || value.some((item) => item.length > 1_024)) {
    throw new GatecrashError(`${label} is too large.`);
  }

  return [...value];
}

function expandEnvironment(
  value: string,
  label: string,
  environment: NodeJS.ProcessEnv,
  resolveEnvironment: boolean,
): string {
  const missing = new Set<string>();
  const expanded = value.replaceAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    if (!resolveEnvironment) {
      return '<environment>';
    }
    const replacement = environment[name];
    if (replacement === undefined) {
      missing.add(name);
      return '';
    }

    return replacement;
  });

  if (missing.size > 0) {
    const names = [...missing].sort().join(', ');
    throw new GatecrashError(`Missing environment variable${missing.size === 1 ? '' : 's'}: ${names}.`, {
      hint: `Set ${names} before running Gatecrash. The value is used by ${label}.`,
    });
  }

  return expanded;
}

function expandedStringMap(
  value: unknown,
  label: string,
  environment: NodeJS.ProcessEnv,
  resolveEnvironment: boolean,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  const record = asRecord(value, label);
  const entries = Object.entries(record).map(([name, item]) => {
    if (typeof item !== 'string') {
      throw new GatecrashError(`${label}.${name} must be a string.`);
    }

    return [
      name,
      expandEnvironment(item, `${label}.${name}`, environment, resolveEnvironment),
    ] as const;
  });

  return Object.fromEntries(entries);
}

function headerMap(
  value: unknown,
  label: string,
  environment: NodeJS.ProcessEnv,
  resolveEnvironment: boolean,
): Record<string, string> {
  if (
    value !== undefined &&
    Object.keys(asRecord(value, label)).length > MAXIMUM_PROFILE_ENTRIES
  ) {
    throw new GatecrashError(`${label} cannot contain more than ${MAXIMUM_PROFILE_ENTRIES} entries.`);
  }
  const headers = expandedStringMap(value, label, environment, resolveEnvironment);
  for (const [name, headerValue] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!HEADER_NAME.test(name) || FORBIDDEN_PROFILE_HEADERS.has(normalized)) {
      throw new GatecrashError(`${label}.${name} is not an allowed request header.`, {
        hint: normalized === 'cookie'
          ? 'Put cookies in the profile cookies mapping.'
          : 'Host and hop-by-hop headers are controlled by Gatecrash.',
      });
    }
    if (headerValue.length > 16_384 || containsRequestControl(headerValue)) {
      throw new GatecrashError(`${label}.${name} contains an invalid header value.`);
    }
  }
  return headers;
}

function cookieMap(
  value: unknown,
  label: string,
  environment: NodeJS.ProcessEnv,
  resolveEnvironment: boolean,
): Record<string, string> {
  if (
    value !== undefined &&
    Object.keys(asRecord(value, label)).length > MAXIMUM_PROFILE_ENTRIES
  ) {
    throw new GatecrashError(`${label} cannot contain more than ${MAXIMUM_PROFILE_ENTRIES} entries.`);
  }
  const cookies = expandedStringMap(value, label, environment, resolveEnvironment);
  for (const [name, cookieValue] of Object.entries(cookies)) {
    if (
      !HEADER_NAME.test(name) ||
      cookieValue.length > 4_096 ||
      cookieValue.includes(';') ||
      containsRequestControl(cookieValue)
    ) {
      throw new GatecrashError(`${label}.${name} is not a valid cookie entry.`);
    }
  }
  return cookies;
}

function parseTarget(raw: UnknownRecord): TargetConfig {
  const target = asRecord(raw.target, 'target');
  allowKeys(
    target,
    ['origin', 'requests_per_second', 'concurrency', 'timeout_ms', 'max_response_bytes'],
    'target',
  );
  const originValue = asString(target.origin, 'target.origin');
  let parsed: URL;

  try {
    parsed = new URL(originValue);
  } catch {
    throw new GatecrashError('target.origin must be an absolute HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new GatecrashError('target.origin must use HTTP or HTTPS.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new GatecrashError('target.origin cannot contain embedded credentials.');
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new GatecrashError('target.origin must contain only the scheme and host.', {
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
  resolveEnvironment: boolean,
): ProfileConfig[] {
  const source = asRecord(raw.profiles, 'profiles');
  if (Object.keys(source).length > MAXIMUM_PROFILES) {
    throw new GatecrashError(`profiles cannot define more than ${MAXIMUM_PROFILES} sessions.`);
  }
  const profiles = Object.entries(source).map(([name, value]) => {
    if (!PROFILE_NAME.test(name)) {
      throw new GatecrashError(`Profile name "${name}" is invalid.`, {
        hint: 'Use 1 to 32 letters, numbers, dots, underscores, or hyphens.',
      });
    }
    if (name === CONTROL_PROFILE) {
      throw new GatecrashError(`Profile name "${CONTROL_PROFILE}" is reserved.`, {
        hint: `Gatecrash sends its own credential-free ${CONTROL_PROFILE} session. `
          + 'Rename this profile, or set compare.control: false to turn that session off.',
      });
    }
    const profile = asRecord(value, `profiles.${name}`);
    allowKeys(profile, ['level', 'headers', 'cookies'], `profiles.${name}`);
    return {
      name,
      level: asNumber(profile.level, 0, `profiles.${name}.level`, {
        minimum: 0,
        maximum: 1_000,
      }),
      headers: headerMap(
        profile.headers,
        `profiles.${name}.headers`,
        environment,
        resolveEnvironment,
      ),
      cookies: cookieMap(
        profile.cookies,
        `profiles.${name}.cookies`,
        environment,
        resolveEnvironment,
      ),
    };
  });

  if (profiles.length < 2) {
    throw new GatecrashError('profiles must define at least two sessions to compare.');
  }

  return profiles;
}

function parseCompare(raw: UnknownRecord, profiles: ProfileConfig[]): CompareConfig {
  const source = raw.compare === undefined ? {} : asRecord(raw.compare, 'compare');
  allowKeys(
    source,
    ['baseline', 'against', 'control', 'similarity_threshold', 'volatile_json_keys'],
    'compare',
  );
  const profileNames = profiles.map((profile) => profile.name);
  const defaultBaseline = [...profiles].sort((left, right) => right.level - left.level)[0]?.name;
  if (defaultBaseline === undefined) {
    throw new GatecrashError('No baseline profile is available.');
  }

  const baseline = source.baseline === undefined
    ? defaultBaseline
    : asString(source.baseline, 'compare.baseline');

  if (!profileNames.includes(baseline)) {
    throw new GatecrashError(`compare.baseline references unknown profile "${baseline}".`);
  }

  const defaultAgainst = profileNames.filter((name) => name !== baseline);
  const against = asStringArray(source.against, defaultAgainst, 'compare.against');
  const unknown = against.filter((name) => !profileNames.includes(name));
  if (unknown.length > 0) {
    throw new GatecrashError(`compare.against references unknown profile "${unknown[0]}".`);
  }

  if (against.includes(baseline)) {
    throw new GatecrashError('compare.against cannot contain the baseline profile.');
  }

  if (against.length === 0) {
    throw new GatecrashError('compare.against must contain at least one profile.');
  }

  if (new Set(against).size !== against.length) {
    throw new GatecrashError('compare.against cannot contain the same profile twice.');
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
    control: asBoolean(source.control, true, 'compare.control'),
  };
}

function parseSample(raw: UnknownRecord): SampleConfig {
  const source = raw.sample === undefined ? {} : asRecord(raw.sample, 'sample');
  allowKeys(source, ['per_pattern'], 'sample');
  return {
    perPattern: Math.floor(
      asNumber(source.per_pattern, 3, 'sample.per_pattern', {minimum: 0, maximum: 10_000}),
    ),
  };
}

function parseExclude(raw: UnknownRecord): ExcludeConfig {
  const source = raw.exclude === undefined ? {} : asRecord(raw.exclude, 'exclude');
  allowKeys(source, ['paths', 'extensions'], 'exclude');
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
  options: ParseConfigOptions = {},
): GatecrashConfig {
  const raw = asRecord(value, 'config');
  allowKeys(raw, ['target', 'profiles', 'compare', 'exclude', 'sample'], 'config');
  const target = parseTarget(raw);
  const profiles = parseProfiles(raw, environment, options.resolveEnvironment ?? true);
  return {
    target,
    profiles,
    compare: parseCompare(raw, profiles),
    exclude: parseExclude(raw),
    sample: parseSample(raw),
  };
}

export async function loadConfig(
  path = 'gatecrash.yml',
  environment: NodeJS.ProcessEnv = process.env,
  options: ParseConfigOptions = {},
): Promise<GatecrashConfig> {
  const absolutePath = resolve(path);
  let contents: string;

  try {
    contents = await readLimitedUtf8File(absolutePath, {
      label: 'Config file',
      maximumBytes: CONFIG_MAXIMUM_BYTES,
    });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new GatecrashError(`Config file not found: ${path}`, {
        hint: 'Run gatecrash init, or pass a file with --config.',
      });
    }

    throw error;
  }

  try {
    return parseConfig(
      parse(contents, {maxAliasCount: 100, uniqueKeys: true}),
      environment,
      options,
    );
  } catch (error) {
    if (error instanceof GatecrashError) {
      throw error;
    }

    throw new GatecrashError(`Could not parse ${path}.`, {
      hint: 'Check the YAML structure, indentation, and duplicate keys.',
    });
  }
}

export function configTemplate(): string {
  return `# Gatecrash reads secrets from the environment. It never writes them to a report.
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
  # Also send every route with no credentials at all. When that session gets
  # the same body as the baseline, the route is public and there is no
  # boundary to have crossed.
  control: true

# A capture of a paginated list is hundreds of rows of one endpoint. Send this
# many members of each path family; 0 sends all of them.
sample:
  per_pattern: 3

exclude:
  paths:
    - /health
    - /assets/**
`;
}
