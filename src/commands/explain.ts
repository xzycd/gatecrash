import {findFinding, latestReport, loadReport} from '../core/report.js';
import {writeFinding} from '../ui/surface.js';

export interface ExplainCommandOptions {
  report?: string;
  plain: boolean;
}

export async function runExplainCommand(id: string, options: ExplainCommandOptions): Promise<void> {
  const reportPath = options.report ?? await latestReport();
  const report = await loadReport(reportPath);
  const finding = findFinding(report, id);
  writeFinding(finding, reportPath, {plain: options.plain});
}
