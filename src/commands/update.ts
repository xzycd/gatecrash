import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COMMAND_NAME, COMPACT_MARK} from '../brand.js';
import {GatecrashError} from '../core/errors.js';
import {
  compareVersions,
  downloadVerifiedRelease,
  findRelease,
} from '../core/update.js';
import {VERSION} from '../version.js';

export interface UpdateCommandOptions {
  check: boolean;
  force: boolean;
}

const INSTALL_ARCHIVE = /(?:^|[\\\\/])xzycd-gatecrash-(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.tgz$/;
const UNSAFE_WINDOWS_PATH = /[\r\n"&|<>()^%!]/;

/**
 * Build the exact npm command so the Windows shell boundary stays testable.
 * Node cannot execute npm.cmd directly on current Windows releases. cmd.exe
 * receives fixed arguments plus a locally generated archive path; shell
 * metacharacters and unexpected archive names are rejected first.
 */
export function installCommand(archivePath: string, platform: string = process.platform): {
  command: string;
  args: string[];
} {
  if (!INSTALL_ARCHIVE.test(archivePath)) {
    throw new GatecrashError('Refusing to install an unrecognised Gatecrash archive.');
  }

  const args = ['install', '--global', '--ignore-scripts', archivePath];
  if (platform === 'win32') {
    if (UNSAFE_WINDOWS_PATH.test(archivePath)) {
      throw new GatecrashError('Refusing to pass an unsafe archive path to npm on Windows.');
    }
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/v:off', '/c', 'npm', ...args],
    };
  }
  return {command: 'npm', args};
}

function installArchive(archivePath: string): Promise<void> {
  const {command, args} = installCommand(archivePath);
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
    'verify   downloading release checksums',
    '',
  ].join('\n'));
  const directory = await mkdtemp(join(tmpdir(), 'gatecrash-update-'));
  try {
    const archive = await downloadVerifiedRelease(release);
    const archivePath = join(directory, release.archive.name);
    await writeFile(archivePath, archive, {mode: 0o600, flag: 'wx'});
    process.stdout.write('verify   SHA-256 matched\ninstall  running npm global install\n\n');
    await installArchive(archivePath);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
  process.stdout.write([
    '',
    `updated  ${VERSION} → ${release.version}`,
    `verify   ${COMMAND_NAME} --version`,
    '',
  ].join('\n'));
}
