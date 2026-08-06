import {readdir} from 'node:fs/promises';
import {extname, join, resolve} from 'node:path';
import {hasErrorCode, readLimitedUtf8File, writePrivateFile} from '../utils/files.js';
import {listOf} from '../utils/format.js';
import {terminalText} from '../utils/security.js';
import {GatecrashError} from './errors.js';
import type {Finding, FindingCrossing, GatecrashReport} from './types.js';

const REPORT_MAXIMUM_BYTES = 25_000_000;
const SUPPORTED_SCHEMAS = new Set([1, 2, 3]);

// A Markdown report is a file that gets pasted into a pull request or a
// ticket, so the renderer on the far end is somebody else's. Paths come from a
// capture, which means an attacker who can shape a URL can shape this text.
// Escaping `<` and `>` stopped the HTML; `[](…)` was left open, so a path
// could still arrive at a reviewer as a working link pointing anywhere.
// Characters that only matter at the start of a line (`#`, `-`, `+`, `.`) are
// left alone: newlines are stripped first, so an escaped value is always
// mid-line and escaping them here would just fill every path with backslashes.
const MARKDOWN_SPECIALS = /[&<>\\`*_{}[\]()|~!]/g;
const MARKDOWN_ENTITIES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;'};

function markdownEscape(value: string): string {
  return terminalText(value)
    .replaceAll(/\r?\n/g, ' ')
    .replaceAll(MARKDOWN_SPECIALS, (character) => MARKDOWN_ENTITIES[character] ?? `\\${character}`);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function reportJson(report: GatecrashReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function crossingText(finding: Finding): string {
  return listOf(finding.crossings.map((crossing) =>
    `${markdownEscape(crossing.challenger)} (${crossing.status})`));
}

export function reportMarkdown(report: GatecrashReport): string {
  const {summary} = report;
  const lines = [
    '# Gatecrash report',
    '',
    `Target: \`${report.run.targetOrigin}\``,
    '',
    `${summary.routes} routes were replayed across ${report.config.profiles.length} sessions, `
    + `producing ${summary.comparisons} comparisons. `
    + `${summary.findings} route${summary.findings === 1 ? '' : 's'} need review: `
    + `${summary.high} high, ${summary.medium} medium, ${summary.low} low confidence.`,
    '',
  ];

  if (report.run.interrupted === true) {
    lines.push(
      '> This run was interrupted. It covers the routes that had been replayed, not the whole plan.',
      '',
    );
  }

  if (report.findings.length === 0) {
    lines.push('No matching successful responses crossed the configured profile boundary.', '');
  } else {
    lines.push('| Finding | Request | Reached by | Match | Confidence |', '|---|---|---|---:|---|');
    for (const finding of report.findings) {
      lines.push(
        `| \`${finding.id}\` | \`${finding.method} ${markdownEscape(finding.path)}\` | `
        + `${markdownEscape(finding.baseline)} (${finding.baselineStatus}) → ${crossingText(finding)} | `
        + `${percent(finding.similarity)} | ${finding.confidence} |`,
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

const MAXIMUM_CROSSINGS = 64;
// A saved report is a file, and a file is something somebody can hand you. The
// views that print one wrap most of what they take, but not all of it, and a
// four-thousand-character method name is a row that runs off the screen. Bound
// it here, at the edge, rather than in each place that draws it.
const MAXIMUM_LABEL = 256;

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAXIMUM_LABEL;
}

function isStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;
}

function isCrossing(value: unknown): value is FindingCrossing {
  return (
    isRecord(value) &&
    isLabel(value.challenger) &&
    isStatus(value.status) &&
    typeof value.similarity === 'number' &&
    value.similarity >= 0 && value.similarity <= 1 &&
    typeof value.exact === 'boolean'
  );
}

/**
 * Schemas 1 and 2 wrote one finding per (route, session) with the session in
 * `challenger`. Schema 3 writes one per route with every session in
 * `crossings`. Both are read: a saved report is the only copy of a run, and
 * `explain` refusing to open last month's is a regression the operator pays
 * for, not the format.
 */
function readCrossings(value: Record<string, unknown>): FindingCrossing[] | undefined {
  if (Array.isArray(value.crossings)) {
    return value.crossings.length >= 1 &&
      value.crossings.length <= MAXIMUM_CROSSINGS &&
      value.crossings.every(isCrossing)
      ? value.crossings
      : undefined;
  }

  if (isLabel(value.challenger) && isStatus(value.challengerStatus)) {
    return [{
      challenger: value.challenger,
      status: value.challengerStatus,
      similarity: typeof value.similarity === 'number' ? value.similarity : 0,
      exact: value.exact === true,
    }];
  }

  return undefined;
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) {
    return false;
  }
  const crossings = readCrossings(value);
  if (crossings === undefined) {
    return false;
  }
  // Older reports are normalized in place so everything downstream sees one
  // shape and no view has to know which schema it came from.
  value.crossings = crossings;

  return (
    typeof value.id === 'string' && /^(?:GST|GTC)-[A-F0-9]{6}$/i.test(value.id) &&
    isLabel(value.routeId) &&
    isLabel(value.method) &&
    isLabel(value.path) &&
    isLabel(value.baseline) &&
    isStatus(value.baselineStatus) &&
    typeof value.similarity === 'number' &&
    value.similarity >= 0 && value.similarity <= 1 &&
    typeof value.exact === 'boolean' &&
    (value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low') &&
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
