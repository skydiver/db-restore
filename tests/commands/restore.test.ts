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

  /**
   * A dump taken before generated columns were excluded still carries those
   * columns. Restoring it is harmless — the database recomputes the value —
   * but the warning must say so, because "removed column" reads like silent
   * data loss when nothing was lost.
   */
  describe('columns present in the dump but absent from the live schema', () => {
    async function writeStaleDump(columns: string[], row: Record<string, unknown>) {
      await writeFile(
        join(tempDir, '_metadata.json'),
        JSON.stringify({
          provider: 'sqlite',
          timestamp: '2026-07-25T20:14:33.703Z',
          tables: ['line_items'],
          version: 1,
        })
      );
      await writeFile(
        join(tempDir, 'line_items.json'),
        JSON.stringify({
          table: 'line_items',
          primaryKeys: ['id'],
          columns: columns.map((name) => ({ name, type: 'REAL' })),
          rows: [row],
        })
      );
    }

    function targetWithGeneratedTotal() {
      const db = new Database(':memory:');
      db.exec(
        `CREATE TABLE line_items (
           id INTEGER PRIMARY KEY,
           quantity INTEGER,
           unit_price REAL,
           total REAL GENERATED ALWAYS AS (quantity * unit_price) STORED
         )`
      );
      const provider = new SqliteProvider();
      provider.connectWithDb(db);
      return { db, provider };
    }

    it('reports a generated column as generated, not as removed', async () => {
      await writeStaleDump(['id', 'quantity', 'unit_price', 'total'], {
        id: 1,
        quantity: 3,
        unit_price: 20,
        total: 60,
      });
      const { db, provider } = targetWithGeneratedTotal();

      const result = await executeRestore(provider, tempDir);

      expect(result.errors).toHaveLength(0);
      const warning = result.warnings.find((w) => w.includes('total'));
      expect(warning).toBeDefined();
      expect(warning).toContain('generated');
      expect(warning).not.toContain('removed');
      db.close();
    });

    it('still recomputes the generated value rather than losing it', async () => {
      await writeStaleDump(['id', 'quantity', 'unit_price', 'total'], {
        id: 1,
        quantity: 3,
        unit_price: 20,
        total: 999,
      });
      const { db, provider } = targetWithGeneratedTotal();

      await executeRestore(provider, tempDir);

      // The database recomputes from the restored inputs; the dump's stale
      // 999 must not survive.
      const rows = (await provider.getRows('line_items')) as Record<string, unknown>[];
      expect(rows[0]?.['total']).toBe(60);
      db.close();
    });

    it('still reports a genuinely dropped column as removed', async () => {
      await writeStaleDump(['id', 'quantity', 'unit_price', 'legacy_note'], {
        id: 1,
        quantity: 3,
        unit_price: 20,
        legacy_note: 'x',
      });
      const { db, provider } = targetWithGeneratedTotal();

      const result = await executeRestore(provider, tempDir);

      const warning = result.warnings.find((w) => w.includes('legacy_note'));
      expect(warning).toBeDefined();
      expect(warning).toContain('removed');
      expect(warning).not.toContain('generated');
      db.close();
    });
  });

  describe('failure isolation', () => {
    async function writeMetadataFile(tables: string[]) {
      await writeFile(
        join(tempDir, '_metadata.json'),
        JSON.stringify({
          provider: 'sqlite',
          timestamp: '2026-07-25T20:14:33.703Z',
          tables,
          version: 1,
        })
      );
    }

    function targetWithUsers() {
      const db = new Database(':memory:');
      db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
      const provider = new SqliteProvider();
      provider.connectWithDb(db);
      return { db, provider };
    }

    it('restores the remaining tables when one dump file is corrupt', async () => {
      await writeMetadataFile(['users', 'broken']);
      await writeFile(
        join(tempDir, 'users.json'),
        JSON.stringify({
          table: 'users',
          primaryKeys: ['id'],
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'TEXT' },
          ],
          rows: [{ id: 1, name: 'Alice' }],
        })
      );
      await writeFile(join(tempDir, 'broken.json'), '{ this is not json');
      const { db, provider } = targetWithUsers();

      const result = await executeRestore(provider, tempDir);

      // The corrupt file is reported against its own name and nothing else
      // is lost — previously it threw before any table was restored.
      expect(result.errors.some((e) => e.includes('broken.json'))).toBe(true);
      expect(result.tables.map((t) => t.table)).toEqual(['users']);
      expect(await provider.getRows('users')).toHaveLength(1);
      db.close();
    });

    it('records a resetSequences failure instead of discarding the whole result', async () => {
      await writeMetadataFile(['users']);
      await writeFile(
        join(tempDir, 'users.json'),
        JSON.stringify({
          table: 'users',
          primaryKeys: ['id'],
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'TEXT' },
          ],
          rows: [{ id: 1, name: 'Alice' }],
        })
      );
      const { db, provider } = targetWithUsers();
      provider.resetSequences = async () => {
        throw new Error('permission denied for sequence users_id_seq');
      };

      const result = await executeRestore(provider, tempDir);

      expect(result.tables).toHaveLength(1);
      expect(result.totalRows).toBe(1);
      expect(result.errors.some((e) => e.includes('permission denied'))).toBe(true);
      db.close();
    });
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
