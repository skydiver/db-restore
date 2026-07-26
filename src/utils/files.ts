import { existsSync } from 'node:fs';
import { chmod, lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { METADATA_FILENAME } from '../constants.js';
import type { DumpMetadata, TableDump } from '../providers/types.js';
import { ensureDir } from './dir-mode.js';
import { describeError } from './error.js';
import { toSafeFilename } from './table-name.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function resolveWithinDir(dir: string, filename: string): string {
  const resolvedDir = resolve(dir);
  const filePath = resolve(resolvedDir, filename);
  if (filePath !== resolvedDir && !filePath.startsWith(resolvedDir + sep)) {
    throw new Error(`Resolved path "${filePath}" escapes directory "${resolvedDir}"`);
  }
  return filePath;
}

export async function writeTableDump(dump: TableDump, dir: string): Promise<void> {
  await ensureDir(dir, DIR_MODE);
  const filename = `${toSafeFilename(dump.table)}.json`;
  const filePath = resolveWithinDir(dir, filename);
  await writeFile(filePath, JSON.stringify(dump, null, 2), { encoding: 'utf-8', mode: FILE_MODE });
  // `mode` on writeFile only applies at creation time; force it on every
  // write so an overwritten dump doesn't keep a looser inherited mode.
  await chmod(filePath, FILE_MODE);
}

/**
 * `resolveWithinDir` compares path strings, which a symlink sidesteps: an
 * entry inside `dir` can point anywhere the process can read. Dump
 * directories may come from `--in`, so entries must be regular files.
 */
async function assertRegularFile(filePath: string): Promise<void> {
  const stats = await lstat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Refusing to read "${filePath}": not a regular file`);
  }
}

/**
 * Checks the fields the restore loop dereferences. A hand-edited or
 * truncated dump would otherwise surface as `undefined` deep inside that
 * loop rather than as a clear statement about which file is unusable.
 */
function assertTableDumpShape(value: unknown, filename: string): asserts value is TableDump {
  const dump = value as Partial<TableDump> | null;
  const invalid =
    typeof dump !== 'object' ||
    dump === null ||
    typeof dump.table !== 'string' ||
    !Array.isArray(dump.columns) ||
    !Array.isArray(dump.rows);
  if (invalid) {
    throw new Error(`Malformed dump file "${filename}": missing table, columns or rows`);
  }
}

export async function readTableDump(filename: string, dir: string): Promise<TableDump> {
  const filePath = resolveWithinDir(dir, filename);
  await assertRegularFile(filePath);
  const content = await readFile(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Malformed dump file "${filename}": ${describeError(err)}`);
  }
  assertTableDumpShape(parsed, filename);
  return parsed;
}

export async function writeMetadata(metadata: DumpMetadata, dir: string): Promise<void> {
  await ensureDir(dir, DIR_MODE);
  const filePath = resolveWithinDir(dir, METADATA_FILENAME);
  await writeFile(filePath, JSON.stringify(metadata, null, 2), {
    encoding: 'utf-8',
    mode: FILE_MODE,
  });
  await chmod(filePath, FILE_MODE);
}

export async function readMetadata(dir: string): Promise<DumpMetadata> {
  const filePath = resolveWithinDir(dir, METADATA_FILENAME);
  await assertRegularFile(filePath);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as DumpMetadata;
}

export async function dumpExists(dir: string): Promise<boolean> {
  return existsSync(resolveWithinDir(dir, METADATA_FILENAME));
}

/**
 * Lists the dump filenames in `dir` without reading their contents. The
 * table identifier deliberately stays out of this listing: it lives in each
 * file's `table` field (dumps written before percent-encoding kept the raw
 * table name as the filename, so the filename cannot be trusted to be it),
 * and reading it here would mean parsing every file twice and letting one
 * unparseable file abort the whole restore. Callers read each dump when
 * they are ready to handle its failure individually.
 */
export async function getTableFiles(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith('.json') && f !== METADATA_FILENAME);

  const entries: string[] = [];
  for (const file of jsonFiles) {
    // Symlinks and other non-regular entries are excluded from the listing
    // rather than aborting it — one hostile entry shouldn't make an
    // otherwise valid dump directory unrestorable.
    const stats = await lstat(resolveWithinDir(dir, file));
    if (!stats.isFile()) continue;

    entries.push(file);
  }
  return entries;
}
