import {loadConfig} from '../core/config.js';
import {checkCapture} from '../core/run.js';
import {reportJson, reportMarkdown} from '../core/report.js';
import type {CheckResult, RunProgress} from '../core/types.js';
import {runWithProgress, writeReport} from '../ui/surface.js';
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

export function writeResult(
  result: CheckResult,
  format: string,
  options: {plain: boolean; failOnReview: boolean},
): void {
  const selected = outputFormat(format);
  if (selected === 'json') {
    process.stdout.write(reportJson(result.report));
  } else if (selected === 'markdown') {
    process.stdout.write(reportMarkdown(result.report));
  } else {
    writeReport(result, {plain: options.plain, failOnReview: options.failOnReview});
  }
}

export async function runCheckCommand(capture: string, options: CheckCommandOptions): Promise<void> {
  const methods = allowedMethods(options.allowMethod);
  const format = outputFormat(options.format);
  const execute = async (onProgress: (progress: RunProgress) => void): Promise<CheckResult> => {
    const config = await loadConfig(options.config);
    return checkCapture(capture, config, {
      allowedMethods: methods,
      save: options.save,
      onProgress,
      ...(options.out === undefined ? {} : {outputPath: options.out}),
    });
  };

  // The live line is only ever drawn for the terminal view. A JSON or Markdown
  // run is on its way into a file or another program, and a progress line on
  // stderr in front of that is noise in somebody's log.
  const result = await runWithProgress(execute, {plain: options.plain || format !== 'terminal'});
  writeResult(result, options.format, {
    plain: options.plain,
    failOnReview: options.failOnReview,
  });

  if (options.failOnReview && result.report.summary.reviews > 0) {
    process.exitCode = 2;
  }
}
