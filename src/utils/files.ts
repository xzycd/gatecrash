import {randomUUID} from 'node:crypto';
import {chmod, mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {GatecrashError} from '../core/errors.js';

export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function readLimitedUtf8File(
  path: string,
  options: {label: string; maximumBytes: number},
): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    throw new GatecrashError(`${options.label} must be a regular file.`);
  }
  if (metadata.size > options.maximumBytes) {
    throw new GatecrashError(
      `${options.label} is too large (${metadata.size.toLocaleString()} bytes).`,
      {hint: `The limit is ${options.maximumBytes.toLocaleString()} bytes.`},
    );
  }
  return readFile(path, 'utf8');
}

export async function writePrivateFile(
  destination: string,
  contents: string,
  options: {replace: boolean},
): Promise<void> {
  await mkdir(dirname(destination), {recursive: true, mode: 0o700});

  if (!options.replace) {
    await writeFile(destination, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    await chmod(destination, 0o600);
    return;
  }

  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
    });
  }
}
