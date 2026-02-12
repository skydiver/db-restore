import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DumpMetadata, TableDump } from '../../src/providers/types.js';
import {
  dumpExists,
  readMetadata,
  readTableDump,
  writeMetadata,
  writeTableDump,
} from '../../src/utils/files.js';

describe('dump file I/O', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-files-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  const tableDump: TableDump = {
    table: 'users',
    primaryKeys: ['id'],
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'string' },
    ],
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
  };

  const metadata: DumpMetadata = {
    provider: 'sqlite',
    timestamp: '2026-02-12T14:30:00.000Z',
    tables: ['users'],
    version: 1,
  };

  it('writes and reads a table dump', async () => {
    await writeTableDump(tableDump, tempDir);
    const loaded = await readTableDump('users', tempDir);
    expect(loaded).toEqual(tableDump);
  });

  it('writes and reads metadata', async () => {
    await writeMetadata(metadata, tempDir);
    const loaded = await readMetadata(tempDir);
    expect(loaded).toEqual(metadata);
  });

  it('detects if a dump exists', async () => {
    expect(await dumpExists(tempDir)).toBe(false);
    await writeMetadata(metadata, tempDir);
    expect(await dumpExists(tempDir)).toBe(true);
  });
});
