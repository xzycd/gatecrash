import {randomUUID} from 'node:crypto';
import {chmod, mkdir, open, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {GatecrashError} from '../core/errors.js';

export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/**
 * Read a text file, refusing to grow past a budget.
 *
 * The size is taken from the open descriptor rather than from the path, so it
 * describes the same file that is about to be read: a `stat(path)` followed by
 * `readFile(path)` can be handed a small file and then read a large one, since
 * nothing binds the two calls to the same inode. The buffer is then sized one
 * byte over what the descriptor reported, so a file that grows underneath the
 * read is reported as too large instead of silently truncated.
 */
export async function readLimitedUtf8File(
  path: string,
  options: {label: string; maximumBytes: number},
): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new GatecrashError(`${options.label} must be a regular file.`);
    }
    if (metadata.size > options.maximumBytes) {
      throw new GatecrashError(
        `${options.label} is too large (${metadata.size.toLocaleString()} bytes).`,
        {hint: `The limit is ${options.maximumBytes.toLocaleString()} bytes.`},
      );
    }

    const buffer = Buffer.allocUnsafe(metadata.size + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const {bytesRead} = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) {
        break;
      }
      filled += bytesRead;
    }

    if (filled > options.maximumBytes) {
      throw new GatecrashError(`${options.label} grew while it was being read.`, {
        hint: 'Copy the file somewhere stable and pass the copy.',
      });
    }
    return buffer.subarray(0, filled).toString('utf8');
  } finally {
    await handle.close();
  }
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
  let renamed = false;
  try {
    await writeFile(temporary, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    renamed = true;
    await chmod(destination, 0o600);
  } finally {
    // Only clean up a temporary file that is still there, and never let the
    // cleanup throw: a failure to unlink used to replace the real error with
    // one about a file nobody asked about.
    if (!renamed) {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
