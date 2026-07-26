import { execFile } from 'node:child_process';
import { chmod, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ARCHIVE_DIR } from '../constants.js';
import { ensureDir } from './dir-mode.js';
import { assertSafeProfileName } from './table-name.js';

const execFileAsync = promisify(execFile);
const ARCHIVE_DIR_MODE = 0o700;
const ARCHIVE_FILE_MODE = 0o600;

/**
 * Filenames that could be misread as tar options (a leading `-`) or that
 * could escape `dumpDir` as a `-C` operand (a path separator) are rejected
 * rather than archived. Combined with the `--` end-of-options marker below,
 * this closes tar argument injection even for filenames this tool didn't
 * itself write (e.g. a `--in` directory supplied by the caller).
 */
function isSafeArchiveEntry(filename: string): boolean {
  return !filename.startsWith('-') && !filename.includes('/') && !filename.includes('\\');
}

export async function archiveDump(dumpDir: string, profileName: string): Promise<string> {
  assertSafeProfileName(profileName);
  await ensureDir(ARCHIVE_DIR, ARCHIVE_DIR_MODE);

  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const archiveName = `${profileName}_${date}_${time}.tar.gz`;
  const archivePath = join(ARCHIVE_DIR, archiveName);

  const files = await readdir(dumpDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json') && isSafeArchiveEntry(f));

  await execFileAsync('tar', ['-czf', archivePath, '-C', dumpDir, '--', ...jsonFiles]);
  // tar's own umask decides the archive's mode otherwise.
  await chmod(archivePath, ARCHIVE_FILE_MODE);

  // Remove original JSON files (keep archive). Files rejected above are
  // left in place rather than silently deleted.
  for (const file of jsonFiles) {
    await rm(join(dumpDir, file));
  }

  return archivePath;
}

export async function deleteDump(dumpDir: string): Promise<void> {
  const files = await readdir(dumpDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  for (const file of jsonFiles) {
    await rm(join(dumpDir, file));
  }
}
