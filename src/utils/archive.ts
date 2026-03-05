import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ARCHIVE_DIR } from '../constants.js';

const execFileAsync = promisify(execFile);

export async function archiveDump(dumpDir: string, profileName: string): Promise<string> {
  await mkdir(ARCHIVE_DIR, { recursive: true });

  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const archiveName = `${profileName}_${date}_${time}.tar.gz`;
  const archivePath = join(ARCHIVE_DIR, archiveName);

  const files = await readdir(dumpDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  await execFileAsync('tar', ['-czf', archivePath, '-C', dumpDir, ...jsonFiles]);

  // Remove original JSON files (keep archive)
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
