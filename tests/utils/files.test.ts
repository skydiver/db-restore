import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DumpMetadata, TableDump } from '../../src/providers/types.js';
import {
  dumpExists,
  getTableFiles,
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
    const loaded = await readTableDump('users.json', tempDir);
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

  it('lists table dumps by reading the table field from file content, not the filename', async () => {
    await writeTableDump(tableDump, tempDir);
    await writeMetadata(metadata, tempDir);

    const entries = await getTableFiles(tempDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.table).toBe('users');
    expect(entries[0]?.file.endsWith('.json')).toBe(true);
  });

  it('excludes the metadata file from getTableFiles', async () => {
    await writeTableDump(tableDump, tempDir);
    await writeMetadata(metadata, tempDir);

    const entries = await getTableFiles(tempDir);

    expect(entries.some((e) => e.file.includes('_metadata'))).toBe(false);
  });

  it.each(['../../evil', '-rf', 'a/b', '.', '..', 'wéird'])(
    'round-trips a hostile table name (%s) through dump and restore',
    async (hostileName) => {
      const hostileDump: TableDump = { ...tableDump, table: hostileName };
      await writeTableDump(hostileDump, tempDir);

      const entries = await getTableFiles(tempDir);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.table).toBe(hostileName);

      const loaded = await readTableDump(entries[0]?.file as string, tempDir);
      expect(loaded.table).toBe(hostileName);
    }
  );

  it('throws if a filename would resolve outside the dump directory', async () => {
    await expect(readTableDump('../outside.json', tempDir)).rejects.toThrow();
  });

  it('restores an old-style dump whose filename is the raw, unencoded table name', async () => {
    const fixtureDir = join(import.meta.dirname, '..', 'fixtures', 'legacy-dump');
    const entries = await getTableFiles(fixtureDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.table).toBe('order items');

    const loaded = await readTableDump(entries[0]?.file as string, fixtureDir);
    expect(loaded.rows).toEqual([{ id: 1, sku: 'ABC-1' }]);
  });
});

describe('file permissions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-perms-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  const tableDump: TableDump = {
    table: 'secrets',
    primaryKeys: ['id'],
    columns: [{ name: 'id', type: 'int' }],
    rows: [{ id: 1 }],
  };

  it.runIf(process.platform !== 'win32')(
    'creates the dump directory and file with restrictive permissions',
    async () => {
      // Must not pre-exist: mkdtemp already creates dirs at 0700, so asserting
      // against it would pass even without the explicit mode.
      const dumpDir = join(tempDir, 'dumps');
      await writeTableDump(tableDump, dumpDir);

      const dirStat = await stat(dumpDir);
      const fileStat = await stat(join(dumpDir, 'secrets.json'));

      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
  );

  it.runIf(process.platform !== 'win32')(
    'restricts permissions even when overwriting an existing dump file',
    async () => {
      const filePath = join(tempDir, 'secrets.json');
      await mkdir(tempDir, { recursive: true });
      await writeFile(filePath, '{}', { mode: 0o644 });

      await writeTableDump(tableDump, tempDir);

      const fileStat = await stat(filePath);
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
  );
});
