import {access, mkdir, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {configTemplate} from '../core/config.js';
import {GuestlistError} from '../core/errors.js';

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
    throw new GuestlistError(`${path} already exists.`, {
      hint: 'Pass --force to replace it.',
    });
  }

  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, configTemplate(), {encoding: 'utf8', mode: 0o600});
  const stateDirectory = resolve('.guestlist');
  await mkdir(stateDirectory, {recursive: true});
  await writeFile(resolve(stateDirectory, '.gitignore'), '*\n!.gitignore\n', 'utf8');
  process.stdout.write([
    'guestlist init',
    `wrote  ${destination}`,
    '',
    'Set the profile tokens in your environment, export a HAR file, then run:',
    `  guestlist check session.har --config ${path}`,
    '',
  ].join('\n'));
}
