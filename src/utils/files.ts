import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { METADATA_FILENAME } from '../constants.js';
import type { DumpMetadata, TableDump } from '../providers/types.js';

export async function writeTableDump(dump: TableDump, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${dump.table}.json`);
  await writeFile(filePath, JSON.stringify(dump, null, 2), 'utf-8');
}

export async function readTableDump(table: string, dir: string): Promise<TableDump> {
  const filePath = join(dir, `${table}.json`);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as TableDump;
}

export async function writeMetadata(metadata: DumpMetadata, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, METADATA_FILENAME);
  await writeFile(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function readMetadata(dir: string): Promise<DumpMetadata> {
  const filePath = join(dir, METADATA_FILENAME);
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as DumpMetadata;
}

export async function dumpExists(dir: string): Promise<boolean> {
  return existsSync(join(dir, METADATA_FILENAME));
}

export async function getTableFiles(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith('.json') && f !== METADATA_FILENAME)
    .map((f) => f.replace('.json', ''));
}
