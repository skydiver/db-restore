import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeDump } from '../../src/commands/dump.js';
import { executeRestore } from '../../src/commands/restore.js';
import { SqliteProvider } from '../../src/providers/sqlite.js';

describe('E2E: full dump → reset → restore flow', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-e2e-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it('preserves data through a simulated migration reset', async () => {
    // === Phase 1: Create database with user data ===
    const db1 = new Database(dbPath);
    db1.exec(`
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, role_id INTEGER REFERENCES roles(id));
      INSERT INTO roles VALUES (1, 'admin'), (2, 'user');
      INSERT INTO users VALUES (1, 'Alice', 'alice@dev.com', 1);
      INSERT INTO users VALUES (2, 'Bob', 'bob@dev.com', 2);
      INSERT INTO users VALUES (3, 'Charlie', 'charlie@dev.com', 2);
    `);

    // === Phase 2: Dump ===
    const dumpDir = join(tempDir, 'backup');
    const dumpProvider = new SqliteProvider();
    dumpProvider.connectWithDb(db1);
    const dumpResult = await executeDump(dumpProvider, 'sqlite', dumpDir);
    db1.close();

    expect(dumpResult.tables).toHaveLength(2);
    expect(dumpResult.totalRows).toBe(5); // 2 roles + 3 users

    // === Phase 3: Simulate migration reset (new schema + seed) ===
    const db2 = new Database(dbPath);
    db2.exec(`
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS roles;
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, avatar TEXT, role_id INTEGER REFERENCES roles(id));
      INSERT INTO roles VALUES (1, 'admin'), (2, 'user'), (3, 'moderator');
    `);
    // Note: "avatar" column is new, "moderator" role is new seed data

    // === Phase 4: Restore ===
    const restoreProvider = new SqliteProvider();
    restoreProvider.connectWithDb(db2);
    const restoreResult = await executeRestore(restoreProvider, dumpDir);

    // === Phase 5: Verify ===
    const roles = db2.prepare('SELECT * FROM roles ORDER BY id').all() as Record<string, unknown>[];
    expect(roles).toHaveLength(3); // 2 from dump (upserted) + 1 new seed (kept)
    expect(roles[2]).toMatchObject({ id: 3, name: 'moderator' }); // new seed preserved

    const users = db2.prepare('SELECT * FROM users ORDER BY id').all() as Record<string, unknown>[];
    expect(users).toHaveLength(3); // all 3 from dump restored
    expect(users[0]).toMatchObject({ id: 1, name: 'Alice', email: 'alice@dev.com' });
    expect(users[0]).toHaveProperty('avatar'); // new column exists, should be null

    // Schema drift warnings
    expect(restoreResult.warnings.some((w) => w.includes('avatar'))).toBe(true);

    db2.close();
  });
});
