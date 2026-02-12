import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function archiveDump(dumpDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `archive-${timestamp}.tar.gz`;
  const archivePath = join(dumpDir, archiveName);

  const files = await readdir(dumpDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  await execFileAsync('tar', ['-czf', archivePath, '-C', dumpDir, ...jsonFiles]);

  // Remove original JSON files (keep archive)
  for (const file of jsonFiles) {
    await rm(join(dumpDir, file));
  }

  return archivePath;
}
