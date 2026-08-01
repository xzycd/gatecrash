import {readdir} from 'node:fs/promises';
import {extname, join, resolve} from 'node:path';
import {hasErrorCode, readLimitedUtf8File, writePrivateFile} from '../utils/files.js';
import {GatecrashError} from './errors.js';
import type {Finding, GatecrashReport} from './types.js';

const REPORT_MAXIMUM_BYTES = 25_000_000;
const SUPPORTED_SCHEMAS = new Set([1, 2]);

function markdownEscape(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('`', "'")
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(/\r?\n/g, ' ');
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function reportJson(report: GatecrashReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function reportMarkdown(report: GatecrashReport): string {
  const lines = [
    '# Gatecrash report',
    '',
    `Target: \`${report.run.targetOrigin}\``,
    '',
    `${report.summary.routes} routes were replayed across ${report.config.profiles.length} profiles. ${report.summary.reviews} result${report.summary.reviews === 1 ? '' : 's'} need review.`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No matching successful responses crossed the configured profile boundary.', '');
  } else {
    lines.push('| Finding | Request | Comparison | Match |', '|---|---|---|---:|');
    for (const finding of report.findings) {
      lines.push(
        `| \`${finding.id}\` | \`${finding.method} ${markdownEscape(finding.path)}\` | ${markdownEscape(finding.baseline)} → ${markdownEscape(finding.challenger)} (${finding.baselineStatus} → ${finding.challengerStatus}) | ${percent(finding.similarity)} |`,
      );
    }
    lines.push('');

    for (const finding of report.findings) {
      lines.push(
        `<details><summary><code>${finding.id}</code> ${markdownEscape(finding.method)} ${markdownEscape(finding.path)}</summary>`,
        '',
        markdownEscape(finding.reason),
        '',
        ...finding.evidence.map((item) => `- ${markdownEscape(item)}`),
        '',
        '</details>',
        '',
      );
    }
  }

  lines.push(
    'Gatecrash reports response similarity. A result still needs manual verification against the application\'s intended access policy.',
    '',
  );
  return lines.join('\n');
}

export function defaultReportPath(startedAt: string): string {
  const safeTime = startedAt.replaceAll(':', '').replaceAll('.', '-');
  return join('.gatecrash', 'runs', `${safeTime}.json`);
}

export async function saveReport(report: GatecrashReport, path?: string): Promise<string> {
  const selectedPath = resolve(path ?? defaultReportPath(report.run.startedAt));
  const format = extname(selectedPath).toLowerCase() === '.md' ? 'markdown' : 'json';
  await writePrivateFile(
    selectedPath,
    format === 'markdown' ? reportMarkdown(report) : reportJson(report),
    {replace: true},
  );
  return selectedPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' && /^(?:GST|GTC)-[A-F0-9]{6}$/i.test(value.id) &&
    typeof value.routeId === 'string' &&
    typeof value.method === 'string' &&
    typeof value.path === 'string' &&
    typeof value.baseline === 'string' &&
    typeof value.challenger === 'string' &&
    typeof value.baselineStatus === 'number' &&
    typeof value.challengerStatus === 'number' &&
    typeof value.similarity === 'number' &&
    value.similarity >= 0 && value.similarity <= 1 &&
    typeof value.exact === 'boolean' &&
    (value.confidence === 'high' || value.confidence === 'medium') &&
    typeof value.reason === 'string' && value.reason.length <= 4_096 &&
    Array.isArray(value.evidence) && value.evidence.length <= 100 &&
    value.evidence.every((item) => typeof item === 'string' && item.length <= 4_096)
  );
}

function isReport(value: unknown): value is GatecrashReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.schemaVersion === 'number' &&
    SUPPORTED_SCHEMAS.has(record.schemaVersion) &&
    typeof record.toolVersion === 'string' &&
    isRecord(record.run) &&
    isRecord(record.config) &&
    isRecord(record.summary) &&
    Array.isArray(record.routes) &&
    Array.isArray(record.findings) &&
    record.findings.every(isFinding) &&
    Array.isArray(record.skipped)
  );
}

export async function loadReport(path: string): Promise<GatecrashReport> {
  let contents: string;
  try {
    contents = await readLimitedUtf8File(resolve(path), {
      label: 'Report file',
      maximumBytes: REPORT_MAXIMUM_BYTES,
    });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new GatecrashError(`Report file not found: ${path}`);
    }
    throw error;
  }

  try {
    const value = JSON.parse(contents) as unknown;
    if (!isReport(value)) {
      throw new Error('missing report fields');
    }
    return value;
  } catch (error) {
    throw new GatecrashError(`Could not read Gatecrash report: ${path}`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function latestReport(directory = join('.gatecrash', 'runs')): Promise<string> {
  let names: string[];
  try {
    names = await readdir(resolve(directory));
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw new GatecrashError('Could not read the saved-run directory.');
    }
    throw new GatecrashError('No saved Gatecrash report was found.', {
      hint: 'Run gatecrash check first, or pass --report.',
    });
  }

  const reports = names.filter((name) => name.endsWith('.json')).sort().reverse();
  const latest = reports[0];
  if (latest === undefined) {
    throw new GatecrashError('No saved Gatecrash report was found.', {
      hint: 'Run gatecrash check first, or pass --report.',
    });
  }

  return join(directory, latest);
}

export function findFinding(report: GatecrashReport, id: string): Finding {
  const normalized = id.toUpperCase();
  const finding = report.findings.find((candidate) => candidate.id.toUpperCase() === normalized);
  if (finding === undefined) {
    throw new GatecrashError(`Finding ${id} does not exist in this report.`);
  }
  return finding;
}
