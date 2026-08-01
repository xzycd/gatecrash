import {spawn} from 'node:child_process';
import {COMMAND_NAME, COMPACT_MARK} from '../brand.js';
import {GatecrashError} from '../core/errors.js';
import {compareVersions, findRelease} from '../core/update.js';
import {VERSION} from '../version.js';

export interface UpdateCommandOptions {
  check: boolean;
  force: boolean;
}

const INSTALL_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The exact command line, so a test can assert on it without spawning npm.
 *
 * Windows needs `cmd.exe` because Node refuses to run a `.cmd` file through
 * `spawn` without a shell, and has done since the fix for the argument-quoting
 * flaw in batch files. Reaching for `shell: true` is the usual way out of that
 * error and is exactly the wrong one: it would hand the whole argument list to
 * a command interpreter. The interpreter here receives only fixed strings and
 * a version that has already been re-checked against a strict pattern, so the
 * assertion below is what keeps it safe rather than a promise about callers.
 */
export function installCommand(version: string, platform: string = process.platform): {
  command: string;
  args: string[];
} {
  if (!INSTALL_VERSION.test(version)) {
    throw new GatecrashError(`Refusing to install an unrecognised version: ${version}`);
  }

  const args = [
    'install',
    '--global',
    '--ignore-scripts',
    '--registry=https://registry.npmjs.org/',
    `@xzycd/gatecrash@${version}`,
  ];
  if (platform === 'win32') {
    return {command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args]};
  }
  return {command: 'npm', args};
}

function installVersion(version: string): Promise<void> {
  const {command, args} = installCommand(version);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', () => {
      reject(new GatecrashError('Could not start npm to install the Gatecrash update.', {
        hint: 'Make sure npm is installed and available on PATH.',
      }));
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new GatecrashError('npm could not install the Gatecrash update.', {
        hint: signal === null
          ? 'Check npm output and make sure its global install directory is writable.'
          : `npm was stopped by ${signal}.`,
      }));
    });
  });
}

export async function runUpdateCommand(
  requestedVersion: string | undefined,
  options: UpdateCommandOptions,
): Promise<void> {
  const release = await findRelease(requestedVersion);
  const comparison = compareVersions(release.version, VERSION);
  const heading = `${COMPACT_MARK} ${COMMAND_NAME} / update`;

  if (comparison === 0 && !options.force) {
    process.stdout.write(`${heading}\ncurrent  ${VERSION}\nstatus   already up to date\n`);
    return;
  }
  if (comparison < 0 && requestedVersion === undefined) {
    process.stdout.write([
      heading,
      `current  ${VERSION}`,
      `latest   ${release.version}`,
      'status   installed version is newer than the latest GitHub release',
      '',
    ].join('\n'));
    return;
  }
  if (comparison < 0 && !options.force && !options.check) {
    throw new GatecrashError(
      `Gatecrash ${release.version} is older than the installed version ${VERSION}.`,
      {hint: `Pass --force to install ${release.version} anyway.`},
    );
  }
  if (options.check) {
    const next = comparison > 0
      ? `${COMMAND_NAME} update${requestedVersion === undefined ? '' : ` ${release.version}`}`
      : `${COMMAND_NAME} update ${release.version} --force`;
    process.stdout.write([
      heading,
      `current  ${VERSION}`,
      `target   ${release.version}`,
      `release  ${release.pageUrl}`,
      comparison > 0
        ? `next     ${next}`
        : comparison === 0
          ? 'status   same version; --force can reinstall it'
          : 'status   selected release is older; --force can install it',
      '',
    ].join('\n'));
    return;
  }

  process.stdout.write([
    heading,
    `current  ${VERSION}`,
    `target   ${release.version}`,
    'source   GitHub release confirmed',
    'install  downloading the exact version from npm',
    '',
  ].join('\n'));
  await installVersion(release.version);
  process.stdout.write([
    '',
    `updated  ${VERSION} → ${release.version}`,
    `verify   ${COMMAND_NAME} --version`,
    '',
  ].join('\n'));
}
