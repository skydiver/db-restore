import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeDump } from '../../src/commands/dump.js';
import { SqliteProvider } from '../../src/providers/sqlite.js';
import { readMetadata, readTableDump } from '../../src/utils/files.js';

describe('dump command', () => {
  let tempDir: string;
  let db: Database.Database;
  let provider: SqliteProvider;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-dump-'));
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY);
      INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');
    `);
    provider = new SqliteProvider();
    provider.connectWithDb(db);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true });
  });

  it('dumps all user tables to JSON files', async () => {
    const result = await executeDump(provider, 'sqlite', tempDir);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.table).toBe('users');
    expect(result.tables[0]?.rowCount).toBe(2);

    const metadata = await readMetadata(tempDir);
    expect(metadata.provider).toBe('sqlite');
    expect(metadata.tables).toEqual(['users']);

    const tableDump = await readTableDump('users', tempDir);
    expect(tableDump.rows).toHaveLength(2);
    expect(tableDump.primaryKeys).toEqual(['id']);
  });

  it('excludes ORM migration tables', async () => {
    const result = await executeDump(provider, 'sqlite', tempDir);
    const tableNames = result.tables.map((t) => t.table);
    expect(tableNames).not.toContain('_prisma_migrations');
  });
});
