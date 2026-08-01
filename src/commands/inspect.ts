import {loadConfig} from '../core/config.js';
import {GatecrashError} from '../core/errors.js';
import {inspectCapture} from '../core/inspect.js';
import {plainInspection} from '../ui/plain.js';
import {showInspectionInterface} from '../ui/run.js';
import {allowedMethods} from './shared.js';

export interface InspectCommandOptions {
  config: string;
  format: string;
  allowMethod?: string[];
  plain: boolean;
}

export async function runInspectCommand(
  capture: string,
  options: InspectCommandOptions,
): Promise<void> {
  if (options.format !== 'terminal' && options.format !== 'json') {
    throw new GatecrashError(`Unknown inspect format: ${options.format}`, {
      hint: 'Use terminal or json.',
    });
  }

  const config = await loadConfig(options.config, process.env, {resolveEnvironment: false});
  const inspection = await inspectCapture(capture, config, allowedMethods(options.allowMethod));
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
    return;
  }
  if (!options.plain && process.stdout.isTTY) {
    showInspectionInterface(inspection);
    return;
  }
  process.stdout.write(plainInspection(inspection));
}
