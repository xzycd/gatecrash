import {loadConfig} from '../core/config.js';
import {checkCapture} from '../core/run.js';
import {reportJson, reportMarkdown} from '../core/report.js';
import type {CheckResult, Confidence, RunProgress} from '../core/types.js';
import {runWithProgress, writeReport} from '../ui/surface.js';
import {findingsAtLeast} from '../ui/view.js';
import {allowedMethods, failOnConfidence, outputFormat} from './shared.js';

export interface CheckCommandOptions {
  config: string;
  format: string;
  out?: string;
  allowMethod?: string[];
  save: boolean;
  plain: boolean;
  failOn?: string;
  failOnReview: boolean;
}

export function writeResult(
  result: CheckResult,
  format: string,
  options: {plain: boolean; failOn?: Confidence},
): void {
  const selected = outputFormat(format);
  if (selected === 'json') {
    process.stdout.write(reportJson(result.report));
  } else if (selected === 'markdown') {
    process.stdout.write(reportMarkdown(result.report));
  } else {
    writeReport(result, {
      plain: options.plain,
      ...(options.failOn === undefined ? {} : {failOn: options.failOn}),
    });
  }
}

/**
 * Stop the run on the first interrupt and let the report be written from what
 * already came back. A second one is taken to mean the operator wants out now
 * and is left to the default handler.
 *
 * `release` matters as much as the handler does. Node suppresses the default
 * terminate-on-SIGINT for as long as any listener is registered, so a handler
 * left behind after the run finishes means the Ctrl-C somebody presses while
 * a long report is printing does nothing at all.
 */
export function interruptSignal(): {signal: AbortSignal; release: () => void} {
  const controller = new AbortController();
  const release = (): void => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  };
  function stop(): void {
    controller.abort();
    release();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return {signal: controller.signal, release};
}

export async function runCheckCommand(capture: string, options: CheckCommandOptions): Promise<void> {
  const methods = allowedMethods(options.allowMethod);
  const format = outputFormat(options.format);
  const failOn = failOnConfidence(options.failOn, options.failOnReview);
  const {signal, release} = interruptSignal();
  const execute = async (onProgress: (progress: RunProgress) => void): Promise<CheckResult> => {
    const config = await loadConfig(options.config);
    return checkCapture(capture, config, {
      allowedMethods: methods,
      save: options.save,
      onProgress,
      signal,
      ...(options.out === undefined ? {} : {outputPath: options.out}),
    });
  };

  // The live line is only ever drawn for the terminal view. A JSON or Markdown
  // run is on its way into a file or another program, and a progress line on
  // stderr in front of that is noise in somebody's log.
  let result: CheckResult;
  try {
    result = await runWithProgress(execute, {plain: options.plain || format !== 'terminal'});
  } finally {
    release();
  }
  writeResult(result, options.format, {
    plain: options.plain,
    ...(failOn === undefined ? {} : {failOn}),
  });

  if (failOn !== undefined && findingsAtLeast(result.report, failOn).length > 0) {
    process.exitCode = 2;
  } else if (result.interrupted === true) {
    // 130 is what a shell reports for a process ended by SIGINT, and a run the
    // operator stopped has not passed anything.
    process.exitCode = 130;
  }
}
