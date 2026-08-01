import {access, mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {COMMAND_NAME, COMPACT_MARK} from '../brand.js';
import {configTemplate} from '../core/config.js';
import {GatecrashError} from '../core/errors.js';
import {writePrivateFile} from '../utils/files.js';
import {terminalText} from '../utils/security.js';

export interface InitCommandOptions {
  force: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runInitCommand(path: string, options: InitCommandOptions): Promise<void> {
  const destination = resolve(path);
  if (!options.force && await exists(destination)) {
    throw new GatecrashError(`${path} already exists.`, {
      hint: 'Pass --force to replace it.',
    });
  }

  await writePrivateFile(destination, configTemplate(), {replace: options.force});
  const stateDirectory = resolve('.gatecrash');
  await mkdir(stateDirectory, {recursive: true, mode: 0o700});
  await writePrivateFile(resolve(stateDirectory, '.gitignore'), '*\n!.gitignore\n', {replace: true});
  process.stdout.write([
    `${COMPACT_MARK} ${COMMAND_NAME} / init`,
    `wrote  ${terminalText(destination)}`,
    '',
    'Set the profile tokens in your environment and export a HAR file.',
    `preview  ${COMMAND_NAME} inspect session.har --config ${terminalText(path)}`,
    `run      ${COMMAND_NAME} check session.har --config ${terminalText(path)}`,
    '',
  ].join('\n'));
}
