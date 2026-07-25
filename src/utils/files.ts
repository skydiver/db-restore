import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { METADATA_FILENAME } from '../constants.js';
import type { DumpMetadata, TableDump } from '../providers/types.js';
import { toSafeFilename } from './table-name.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export interface TableFileEntry {
  file: string;
  table: string;
}

function resolveWithinDir(dir: string, filename: string): string {
  const resolvedDir = resolve(dir);
  const filePath = resolve(resolvedDir, filename);
  if (filePath !== resolvedDir && !filePath.startsWith(resolvedDir + sep)) {
    throw new Error(`Resolved path "${filePath}" escapes directory "${resolvedDir}"`);
  }
  return filePath;
}

export async function writeTableDump(dump: TableDump, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const filename = `${toSafeFilename(dump.table)}.json`;
  const filePath = resolveWithinDir(dir, filename);
  await writeFile(filePath, JSON.stringify(dump, null, 2), { encoding: 'utf-8', mode: FILE_MODE });
  // `mode` on writeFile only applies at creation time; force it on every
  // write so an overwritten dump doesn't keep a looser inherited mode.
  await chmod(filePath, FILE_MODE);
}

export async function readTableDump(filename: string, dir: string): Promise<TableDump> {
  const filePath = resolveWithinDir(dir, filename);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as TableDump;
}

export async function writeMetadata(metadata: DumpMetadata, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const filePath = resolveWithinDir(dir, METADATA_FILENAME);
  await writeFile(filePath, JSON.stringify(metadata, null, 2), {
    encoding: 'utf-8',
    mode: FILE_MODE,
  });
  await chmod(filePath, FILE_MODE);
}

export async function readMetadata(dir: string): Promise<DumpMetadata> {
  const filePath = resolveWithinDir(dir, METADATA_FILENAME);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as DumpMetadata;
}

export async function dumpExists(dir: string): Promise<boolean> {
  return existsSync(resolveWithinDir(dir, METADATA_FILENAME));
}

/**
 * Lists the table dumps in `dir`. The real table identifier is read from
 * each file's `table` field rather than derived from the filename: dumps
 * written before percent-encoding was introduced kept the raw table name
 * as the filename, and old and new dumps must both restore correctly.
 */
export async function getTableFiles(dir: string): Promise<TableFileEntry[]> {
  const files = await readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith('.json') && f !== METADATA_FILENAME);

  const entries: TableFileEntry[] = [];
  for (const file of jsonFiles) {
    const dump = await readTableDump(file, dir);
    entries.push({ file, table: dump.table });
  }
  return entries;
}
