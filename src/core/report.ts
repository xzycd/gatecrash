import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, extname, join, resolve} from 'node:path';
import {GuestlistError} from './errors.js';
import type {Finding, GuestlistReport} from './types.js';

function markdownEscape(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function reportJson(report: GuestlistReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function reportMarkdown(report: GuestlistReport): string {
  const lines = [
    '# Guestlist report',
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
        finding.reason,
        '',
        ...finding.evidence.map((item) => `- ${item}`),
        '',
        '</details>',
        '',
      );
    }
  }

  lines.push(
    'Guestlist reports response similarity. A result still needs manual verification against the application\'s intended access policy.',
    '',
  );
  return lines.join('\n');
}

export function defaultReportPath(startedAt: string): string {
  const safeTime = startedAt.replaceAll(':', '').replaceAll('.', '-');
  return join('.guestlist', 'runs', `${safeTime}.json`);
}

export async function saveReport(report: GuestlistReport, path?: string): Promise<string> {
  const selectedPath = resolve(path ?? defaultReportPath(report.run.startedAt));
  await mkdir(dirname(selectedPath), {recursive: true});
  const format = extname(selectedPath).toLowerCase() === '.md' ? 'markdown' : 'json';
  await writeFile(
    selectedPath,
    format === 'markdown' ? reportMarkdown(report) : reportJson(report),
    {encoding: 'utf8', mode: 0o600},
  );
  return selectedPath;
}

function isReport(value: unknown): value is GuestlistReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.schemaVersion === 'number' && Array.isArray(record.findings);
}

export async function loadReport(path: string): Promise<GuestlistReport> {
  let contents: string;
  try {
    contents = await readFile(resolve(path), 'utf8');
  } catch {
    throw new GuestlistError(`Report file not found: ${path}`);
  }

  try {
    const value = JSON.parse(contents) as unknown;
    if (!isReport(value)) {
      throw new Error('missing report fields');
    }
    return value;
  } catch (error) {
    throw new GuestlistError(`Could not read Guestlist report: ${path}`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function latestReport(directory = join('.guestlist', 'runs')): Promise<string> {
  let names: string[];
  try {
    names = await readdir(resolve(directory));
  } catch {
    throw new GuestlistError('No saved Guestlist report was found.', {
      hint: 'Run guestlist check first, or pass --report.',
    });
  }

  const reports = names.filter((name) => name.endsWith('.json')).sort().reverse();
  const latest = reports[0];
  if (latest === undefined) {
    throw new GuestlistError('No saved Guestlist report was found.', {
      hint: 'Run guestlist check first, or pass --report.',
    });
  }

  return join(directory, latest);
}

export function findFinding(report: GuestlistReport, id: string): Finding {
  const normalized = id.toUpperCase();
  const finding = report.findings.find((candidate) => candidate.id.toUpperCase() === normalized);
  if (finding === undefined) {
    throw new GuestlistError(`Finding ${id} does not exist in this report.`);
  }
  return finding;
}
