import {COMMAND_NAME, DESCRIPTION, TAGLINE} from '../brand.js';
import {errorMessage, GatecrashError} from '../core/errors.js';
import type {
  CheckResult,
  Finding,
  GatecrashReport,
  InspectionResult,
} from '../core/types.js';
import {formatDuration, plural} from '../utils/format.js';
import {terminalText} from '../utils/security.js';

function responseStatus(report: GatecrashReport, routeId: string, profile: string): string {
  const route = report.routes.find(({id}) => id === routeId);
  const response = route?.responses.find((item) => item.profile === profile);
  if (response?.error !== undefined) {
    return 'error';
  }
  return response?.status === undefined ? '-' : String(response.status);
}

export function plainWelcome(): string {
  return [
    `${COMMAND_NAME}  ${TAGLINE}`,
    DESCRIPTION,
    '',
    `try      ${COMMAND_NAME} demo`,
    `set up   ${COMMAND_NAME} init`,
    `preview  ${COMMAND_NAME} inspect capture.har`,
    `help     ${COMMAND_NAME} --help`,
    '',
  ].join('\n');
}

export function plainReport(result: CheckResult): string {
  const {report} = result;
  const lines = [
    `${COMMAND_NAME} check  ${terminalText(report.run.targetOrigin)}`,
    `${plural(report.summary.routes, 'route')} × ${plural(report.config.profiles.length, 'session')} · ${formatDuration(report.run.durationMs)}`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No matching successful response crossed the configured profile boundary.');
  } else {
    lines.push(`${plural(report.findings.length, 'result')} need review:`, '');
    for (const finding of report.findings) {
      lines.push(
        `${terminalText(finding.id)}  ${finding.method} ${terminalText(finding.path)}`,
        `  ${terminalText(finding.baseline)} ${responseStatus(report, finding.routeId, finding.baseline)} -> ${terminalText(finding.challenger)} ${responseStatus(report, finding.routeId, finding.challenger)} · ${finding.exact ? 'exact match' : `${Math.round(finding.similarity * 100)}% match`}`,
        `  ${terminalText(finding.reason)}`,
      );
    }
  }

  lines.push(
    '',
    `${report.summary.reviews} review · ${report.summary.blocked} blocked · ${report.summary.changed} changed · ${report.summary.errors} errors · ${report.summary.skipped} skipped`,
  );
  if (result.reportPath !== undefined) {
    lines.push(`report  ${terminalText(result.reportPath)}`);
  }
  const first = report.findings[0];
  if (first !== undefined) {
    lines.push(`next    ${COMMAND_NAME} explain ${terminalText(first.id)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function plainInspection(inspection: InspectionResult): string {
  const lines = [
    `${COMMAND_NAME} inspect  ${terminalText(inspection.targetOrigin)}`,
    'No requests sent.',
    '',
    `${inspection.routes.length} routes × ${inspection.profiles} sessions = ${inspection.replays} requests`,
    `${terminalText(inspection.baseline)} -> ${inspection.challengers.map(terminalText).join(', ')}`,
    `methods  ${inspection.allowedMethods.join(', ')}`,
    '',
    'In scope:',
    ...inspection.routes.slice(0, 20).map((route) => `  ${route.method} ${terminalText(route.path)}`),
  ];
  if (inspection.routes.length > 20) {
    lines.push(`  +${inspection.routes.length - 20} more`);
  }
  if (inspection.skipped.length > 0) {
    lines.push('', `${inspection.skipped.length} skipped. Use --format json for details.`);
  }
  lines.push('', `run  ${COMMAND_NAME} check ${terminalText(inspection.input)}`, '');
  return lines.join('\n');
}

export function plainFinding(finding: Finding, reportPath: string): string {
  return [
    `${COMMAND_NAME} explain  ${terminalText(finding.id)}`,
    `${terminalText(finding.method)} ${terminalText(finding.path)}`,
    '',
    `${terminalText(finding.baseline)} ${finding.baselineStatus} -> ${terminalText(finding.challenger)} ${finding.challengerStatus}`,
    terminalText(finding.reason),
    ...finding.evidence.map((item) => `  - ${terminalText(item)}`),
    '',
    'Treat this as a lead, not a vulnerability verdict.',
    `report  ${terminalText(reportPath)}`,
    '',
  ].join('\n');
}

export function plainError(error: unknown): string {
  const lines = [`${COMMAND_NAME} error  ${terminalText(errorMessage(error))}`];
  if (error instanceof GatecrashError && error.hint !== undefined) {
    lines.push(`fix  ${terminalText(error.hint)}`);
  }
  return `${lines.join('\n')}\n`;
}
