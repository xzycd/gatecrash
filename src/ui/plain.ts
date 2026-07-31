import {errorMessage, GuestlistError} from '../core/errors.js';
import type {CheckResult, Finding, GuestlistReport} from '../core/types.js';
import {formatDuration, plural} from '../utils/format.js';

function status(report: GuestlistReport, routeId: string, profile: string): string {
  const route = report.routes.find(({id}) => id === routeId);
  const response = route?.responses.find((item) => item.profile === profile);
  if (response?.error !== undefined) {
    return 'error';
  }
  return response?.status === undefined ? '-' : String(response.status);
}

export function plainReport(result: CheckResult): string {
  const {report} = result;
  const lines = [
    `guestlist check  ${report.run.targetOrigin}`,
    `${plural(report.summary.routes, 'route')} · ${plural(report.config.profiles.length, 'profile')} · ${formatDuration(report.run.durationMs)}`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No matching successful responses crossed the configured profile boundary.');
  } else {
    lines.push(`${plural(report.findings.length, 'result')} to review:`, '');
    for (const finding of report.findings) {
      lines.push(
        `${finding.id}  ${finding.method} ${finding.path}`,
        `  ${finding.baseline} ${status(report, finding.routeId, finding.baseline)} -> ${finding.challenger} ${status(report, finding.routeId, finding.challenger)} · ${finding.exact ? 'exact body match' : `${Math.round(finding.similarity * 100)}% body match`}`,
        `  ${finding.reason}`,
      );
    }
  }

  lines.push(
    '',
    `${report.summary.blocked} blocked · ${report.summary.changed} changed · ${report.summary.skipped} skipped`,
  );
  if (result.reportPath !== undefined) {
    lines.push(`report  ${result.reportPath}`);
  }
  const first = report.findings[0];
  if (first !== undefined) {
    lines.push(`next    guestlist explain ${first.id}`);
  }
  return `${lines.join('\n')}\n`;
}

export function plainFinding(finding: Finding, reportPath: string): string {
  return [
    `guestlist explain  ${finding.id}`,
    `${finding.method} ${finding.path}`,
    '',
    `${finding.baseline} ${finding.baselineStatus} -> ${finding.challenger} ${finding.challengerStatus}`,
    finding.reason,
    ...finding.evidence.map((item) => `  - ${item}`),
    '',
    'Treat this as a lead, not a vulnerability verdict.',
    `report  ${reportPath}`,
    '',
  ].join('\n');
}

export function plainError(error: unknown): string {
  const lines = [`guestlist error  ${errorMessage(error)}`];
  if (error instanceof GuestlistError && error.hint !== undefined) {
    lines.push(`hint  ${error.hint}`);
  }
  return `${lines.join('\n')}\n`;
}
