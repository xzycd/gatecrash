import {startDemoLab} from '../core/demo-lab.js';
import {checkRequests} from '../core/run.js';
import type {CheckResult, RunProgress} from '../core/types.js';
import {runWithProgress} from '../ui/surface.js';
import {writeResult} from './check.js';
import {allowedMethods, outputFormat} from './shared.js';

export interface DemoCommandOptions {
  format: string;
  out?: string;
  save: boolean;
  plain: boolean;
}

export async function runDemoCommand(options: DemoCommandOptions): Promise<void> {
  const lab = await startDemoLab();
  const format = outputFormat(options.format);
  try {
    const execute = (onProgress: (progress: RunProgress) => void): Promise<CheckResult> => checkRequests(
      lab.requests,
      lab.config,
      {
        inputLabel: 'built-in doorlab',
        allowedMethods: allowedMethods(),
        save: options.save,
        onProgress,
        ...(options.out === undefined ? {} : {outputPath: options.out}),
      },
    );
    const result = await runWithProgress(execute, {plain: options.plain || format !== 'terminal'});
    writeResult(result, options.format, {plain: options.plain, failOnReview: false});
  } finally {
    await lab.close();
  }
}
