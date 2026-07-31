import {findFinding, latestReport, loadReport} from '../core/report.js';
import {plainFinding} from '../ui/plain.js';
import {showFindingInterface} from '../ui/run.js';

export interface ExplainCommandOptions {
  report?: string;
  plain: boolean;
}

export async function runExplainCommand(id: string, options: ExplainCommandOptions): Promise<void> {
  const reportPath = options.report ?? await latestReport();
  const report = await loadReport(reportPath);
  const finding = findFinding(report, id);
  if (!options.plain && process.stdout.isTTY) {
    showFindingInterface(finding, reportPath);
  } else {
    process.stdout.write(plainFinding(finding, reportPath));
  }
}
