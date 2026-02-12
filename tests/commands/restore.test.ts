import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeDump } from '../../src/commands/dump.js';
import { executeRestore } from '../../src/commands/restore.js';
import { SqliteProvider } from '../../src/providers/sqlite.js';

describe('restore command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-restore-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it('restores dumped data via UPSERT', async () => {
    // 1. Create source DB and dump
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
      INSERT INTO users VALUES (1, 'Alice', 'alice@test.com');
      INSERT INTO users VALUES (2, 'Bob', 'bob@test.com');
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    // 2. Create target DB (simulates post-migration state with seed data)
    const targetDb = new Database(':memory:');
    targetDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
      INSERT INTO users VALUES (1, 'Alice Seed', 'seed@test.com');
      INSERT INTO users VALUES (3, 'NewSeedUser', 'new@test.com');
    `);
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    // 3. Restore
    const result = await executeRestore(targetProvider, tempDir);

    // 4. Verify: dump rows updated, seed-only rows preserved
    const rows = await targetProvider.getRows('users');
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual({ id: 1, name: 'Alice', email: 'alice@test.com' });
    expect(rows).toContainEqual({ id: 2, name: 'Bob', email: 'bob@test.com' });
    expect(rows).toContainEqual({ id: 3, name: 'NewSeedUser', email: 'new@test.com' });

    expect(result.tables).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
    targetDb.close();
  });

  it('handles schema drift with warnings', async () => {
    // Dump with columns: id, name, email
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
      INSERT INTO users VALUES (1, 'Alice', 'alice@test.com');
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    // Target has different columns: id, name, avatar (email removed, avatar added)
    const targetDb = new Database(':memory:');
    targetDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, avatar TEXT);
    `);
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    const result = await executeRestore(targetProvider, tempDir);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('email'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('avatar'))).toBe(true);

    const rows = await targetProvider.getRows('users');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, name: 'Alice' });
    targetDb.close();
  });

  it('falls back to truncate+insert for tables without PK', async () => {
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE logs (message TEXT, level TEXT);
      INSERT INTO logs VALUES ('hello', 'info');
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    const targetDb = new Database(':memory:');
    targetDb.exec(`
      CREATE TABLE logs (message TEXT, level TEXT);
      INSERT INTO logs VALUES ('seed log', 'debug');
    `);
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    const result = await executeRestore(targetProvider, tempDir);

    // Truncate + insert: only dump rows should remain
    const rows = await targetProvider.getRows('logs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ message: 'hello', level: 'info' });
    expect(result.warnings.some((w) => w.includes('no primary key'))).toBe(true);
    targetDb.close();
  });
});
