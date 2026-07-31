import {startDemoLab} from '../core/demo-lab.js';
import {checkRequests} from '../core/run.js';
import {reportJson, reportMarkdown} from '../core/report.js';
import type {CheckResult, RunProgress} from '../core/types.js';
import {plainReport} from '../ui/plain.js';
import {runCheckInterface} from '../ui/run.js';
import {allowedMethods, outputFormat} from './shared.js';

export interface DemoCommandOptions {
  format: string;
  out?: string;
  save: boolean;
  plain: boolean;
}

function print(result: CheckResult, format: string): void {
  const selected = outputFormat(format);
  process.stdout.write(
    selected === 'json'
      ? reportJson(result.report)
      : selected === 'markdown'
        ? reportMarkdown(result.report)
        : plainReport(result),
  );
}

export async function runDemoCommand(options: DemoCommandOptions): Promise<void> {
  const lab = await startDemoLab();
  try {
    const execute = (onProgress?: (progress: RunProgress) => void): Promise<CheckResult> => checkRequests(
      lab.requests,
      lab.config,
      {
        inputLabel: 'built-in doorlab',
        allowedMethods: allowedMethods(),
        save: options.save,
        ...(options.out === undefined ? {} : {outputPath: options.out}),
        ...(onProgress === undefined ? {} : {onProgress}),
      },
    );
    const useInterface = outputFormat(options.format) === 'terminal' && !options.plain && process.stdout.isTTY;
    if (useInterface) {
      const settlement = await runCheckInterface(execute);
      if (settlement.error !== undefined || settlement.result === undefined) {
        process.exitCode = 1;
      }
    } else {
      print(await execute(), options.format);
    }
  } finally {
    await lab.close();
  }
}
