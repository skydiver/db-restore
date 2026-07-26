import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    expect(rows).toContainEqual({ id: 1n, name: 'Alice', email: 'alice@test.com' });
    expect(rows).toContainEqual({ id: 2n, name: 'Bob', email: 'bob@test.com' });
    expect(rows).toContainEqual({ id: 3n, name: 'NewSeedUser', email: 'new@test.com' });

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
    expect(rows[0]).toMatchObject({ id: 1n, name: 'Alice' });
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

  it('rolls back the whole table when an insert fails mid-batch, preserving pre-existing rows', async () => {
    // Source dump: one valid new row, one row that violates a CHECK
    // constraint the target enforces (the target schema is stricter than
    // the source's, simulating a partially-applied migration).
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, balance INTEGER);
      INSERT INTO accounts VALUES (2, 'New', 50);
      INSERT INTO accounts VALUES (3, NULL, 10);
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    const targetDb = new Database(':memory:');
    targetDb.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        balance INTEGER
      );
      INSERT INTO accounts VALUES (1, 'Existing', 100);
    `);
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    const result = await executeRestore(targetProvider, tempDir);

    expect(result.errors.length).toBeGreaterThan(0);

    const rows = await targetProvider.getRows('accounts');
    // The pre-existing row survives, and the valid row that would have
    // been inserted before the failing one was rolled back with it — no
    // partial write from the failed table.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1n, name: 'Existing', balance: 100n });
    targetDb.close();
  });

  it('round-trips a 64-bit integer beyond Number.MAX_SAFE_INTEGER exactly', async () => {
    const BIG = 9007199254740993n; // 2^53 + 1 — not exactly representable as a double

    const sourceDb = new Database(':memory:');
    sourceDb.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, external_id INTEGER)');
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    sourceDb.prepare('INSERT INTO events (id, external_id) VALUES (?, ?)').run(1, BIG);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    const targetDb = new Database(':memory:');
    targetDb.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, external_id INTEGER)');
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    const result = await executeRestore(targetProvider, tempDir);
    expect(result.errors).toHaveLength(0);

    const rows = await targetProvider.getRows('events');
    expect(rows[0]?.['external_id']).toBe(BIG);
    targetDb.close();
  });

  it('rejects restoring a dump made with a different provider', async () => {
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO users VALUES (1, 'Alice');
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    // Tamper with the metadata to claim it came from a different provider.
    const metadataPath = join(tempDir, '_metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
    metadata.provider = 'postgres';
    await writeFile(metadataPath, JSON.stringify(metadata));

    const targetDb = new Database(':memory:');
    targetDb.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    await expect(executeRestore(targetProvider, tempDir)).rejects.toThrow(/postgres/i);
    await expect(executeRestore(targetProvider, tempDir)).rejects.toThrow(/sqlite/i);
    targetDb.close();
  });

  it('rejects restoring a dump with a mismatched format version', async () => {
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO users VALUES (1, 'Alice');
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    const metadataPath = join(tempDir, '_metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
    metadata.version = metadata.version + 1;
    await writeFile(metadataPath, JSON.stringify(metadata));

    const targetDb = new Database(':memory:');
    targetDb.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    await expect(executeRestore(targetProvider, tempDir)).rejects.toThrow(/version/i);
    targetDb.close();
  });

  it('builds matchingColumns from the live schema, not the dump, when types differ', async () => {
    const sourceDb = new Database(':memory:');
    sourceDb.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY, price TEXT);
      INSERT INTO items VALUES (1, '9.99');
    `);
    const sourceProvider = new SqliteProvider();
    sourceProvider.connectWithDb(sourceDb);
    await executeDump(sourceProvider, 'sqlite', tempDir);
    sourceDb.close();

    // Target schema has since migrated "price" from TEXT to REAL. The dump's
    // recorded column type is stale ("TEXT"); the live schema's type
    // ("REAL") must be what upsertRows actually receives.
    const targetDb = new Database(':memory:');
    targetDb.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, price REAL)');
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    const originalUpsertRows = targetProvider.upsertRows.bind(targetProvider);
    let observedType: string | undefined;
    targetProvider.upsertRows = async (table, columns, primaryKeys, rows) => {
      observedType = columns.find((c) => c.name === 'price')?.type;
      return originalUpsertRows(table, columns, primaryKeys, rows);
    };

    await executeRestore(targetProvider, tempDir);

    expect(observedType).toBe('REAL');
    targetDb.close();
  });

  it('restores a table with a quoted/hostile name from a legacy dump fixture', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/legacy-dump');

    const targetDb = new Database(':memory:');
    targetDb.exec(`CREATE TABLE "order items" (id INTEGER PRIMARY KEY, sku TEXT)`);
    const targetProvider = new SqliteProvider();
    targetProvider.connectWithDb(targetDb);

    const result = await executeRestore(targetProvider, fixtureDir);

    expect(result.errors).toHaveLength(0);
    const rows = await targetProvider.getRows('order items');
    expect(rows).toHaveLength(1);
    targetDb.close();
  });
});
