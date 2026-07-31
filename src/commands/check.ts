import {loadConfig} from '../core/config.js';
import {checkCapture} from '../core/run.js';
import {reportJson, reportMarkdown} from '../core/report.js';
import type {CheckResult, RunProgress} from '../core/types.js';
import {plainError, plainReport} from '../ui/plain.js';
import {runCheckInterface} from '../ui/run.js';
import {allowedMethods, outputFormat} from './shared.js';

export interface CheckCommandOptions {
  config: string;
  format: string;
  out?: string;
  allowMethod?: string[];
  save: boolean;
  plain: boolean;
  failOnReview: boolean;
}

function writeResult(result: CheckResult, format: string): void {
  const selected = outputFormat(format);
  if (selected === 'json') {
    process.stdout.write(reportJson(result.report));
  } else if (selected === 'markdown') {
    process.stdout.write(reportMarkdown(result.report));
  } else {
    process.stdout.write(plainReport(result));
  }
}

export async function runCheckCommand(capture: string, options: CheckCommandOptions): Promise<void> {
  const methods = allowedMethods(options.allowMethod);
  const execute = async (onProgress?: (progress: RunProgress) => void): Promise<CheckResult> => {
    const config = await loadConfig(options.config);
    return checkCapture(capture, config, {
      allowedMethods: methods,
      save: options.save,
      ...(options.out === undefined ? {} : {outputPath: options.out}),
      ...(onProgress === undefined ? {} : {onProgress}),
    });
  };

  const useInterface = outputFormat(options.format) === 'terminal' && !options.plain && process.stdout.isTTY;
  let result: CheckResult;
  if (useInterface) {
    const settlement = await runCheckInterface(execute);
    if (settlement.error !== undefined) {
      process.exitCode = 1;
      return;
    }
    if (settlement.result === undefined) {
      process.stderr.write(plainError(new Error('The check ended without a report.')));
      process.exitCode = 1;
      return;
    }
    result = settlement.result;
  } else {
    result = await execute();
    writeResult(result, options.format);
  }

  if (options.failOnReview && result.report.summary.reviews > 0) {
    process.exitCode = 2;
  }
}
