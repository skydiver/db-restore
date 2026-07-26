import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeRestore } from '../../src/commands/restore.js';
import { DUMP_FORMAT_VERSION } from '../../src/constants.js';
import { PostgresProvider } from '../../src/providers/postgres.js';
import { writeMetadata, writeTableDump } from '../../src/utils/files.js';

const TEST_DB = 'db_restore_test';
// Overridable so the suite can run against any local Postgres (e.g. a project
// container) instead of only a postgres/postgres one.
const TEST_CONFIG = {
  host: process.env['PGHOST'] ?? 'localhost',
  port: Number(process.env['PGPORT'] ?? 5432),
  database: TEST_DB,
  user: process.env['PGUSER'] ?? 'postgres',
  password: process.env['PGPASSWORD'] ?? 'postgres',
};

async function isPostgresAvailable(): Promise<boolean> {
  const client = new pg.Client({ ...TEST_CONFIG, database: 'postgres' });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const pgAvailable = await isPostgresAvailable();

describe.skipIf(!pgAvailable)('PostgresProvider', () => {
  let provider: PostgresProvider;

  beforeAll(async () => {
    // Create test database
    const adminClient = new pg.Client({ ...TEST_CONFIG, database: 'postgres' });
    await adminClient.connect();
    await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminClient.query(`CREATE DATABASE ${TEST_DB}`);
    await adminClient.end();

    // Set up schema
    const setupClient = new pg.Client(TEST_CONFIG);
    await setupClient.connect();
    await setupClient.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
      INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com');
      INSERT INTO users (name, email) VALUES ('Bob', 'bob@test.com');

      CREATE TABLE line_items (
        id SERIAL PRIMARY KEY,
        quantity INTEGER NOT NULL,
        unit_price NUMERIC NOT NULL,
        total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED
      );
      INSERT INTO line_items (quantity, unit_price) VALUES (2, 10.00);
    `);
    await setupClient.end();
  });

  afterAll(async () => {
    const adminClient = new pg.Client({ ...TEST_CONFIG, database: 'postgres' });
    await adminClient.connect();
    await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminClient.end();
  });

  beforeEach(async () => {
    provider = new PostgresProvider();
    await provider.connect(TEST_CONFIG);
  });

  afterEach(async () => {
    await provider.disconnect();
  });

  it('gets tables', async () => {
    const tables = await provider.getTables();
    expect(tables).toContain('users');
  });

  it('gets columns', async () => {
    const columns = await provider.getColumns('users');
    expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'email']);
  });

  it('excludes generated columns, which the database computes and refuses inserts into', async () => {
    const columns = await provider.getColumns('line_items');
    expect(columns.map((c) => c.name)).toEqual(['id', 'quantity', 'unit_price']);
  });

  it('names the generated columns that getColumns filters out', async () => {
    expect(await provider.getGeneratedColumns('line_items')).toEqual(['total']);
    expect(await provider.getGeneratedColumns('users')).toEqual([]);
  });

  it('upserts a row into a table that has a generated column', async () => {
    const columns = await provider.getColumns('line_items');

    await provider.upsertRows(
      'line_items',
      columns,
      ['id'],
      [{ id: 1, quantity: 3, unit_price: '20.00' }]
    );

    const rows = (await provider.getRows('line_items')) as Record<string, unknown>[];
    const row = rows.find((r) => r['id'] === 1) as Record<string, unknown>;
    expect(row['quantity']).toBe(3);
    // Recomputed by the database, not restored from the dump.
    expect(Number(row['total'])).toBe(60);
  });

  it('gets primary keys', async () => {
    const pks = await provider.getPrimaryKeys('users');
    expect(pks).toEqual(['id']);
  });

  it('gets rows', async () => {
    const rows = await provider.getRows('users');
    expect(rows).toHaveLength(2);
  });

  describe('withTransaction (restore atomicity)', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'db-restore-pg-tx-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true });
    });

    it('rolls back the whole table when an insert fails mid-batch, preserving pre-existing rows', async () => {
      const setupClient = new pg.Client(TEST_CONFIG);
      await setupClient.connect();
      await setupClient.query(`
        DROP TABLE IF EXISTS accounts;
        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER
        );
        INSERT INTO accounts VALUES (1, 'Existing', 100);
      `);
      await setupClient.end();

      await writeTableDump(
        {
          table: 'accounts',
          primaryKeys: ['id'],
          columns: [
            { name: 'id', type: 'integer' },
            { name: 'name', type: 'text' },
            { name: 'balance', type: 'integer' },
          ],
          rows: [
            { id: 2, name: 'New', balance: 50 },
            { id: 3, name: null, balance: 10 },
          ],
        },
        tempDir
      );
      await writeMetadata(
        {
          provider: 'postgres',
          timestamp: new Date().toISOString(),
          tables: ['accounts'],
          version: DUMP_FORMAT_VERSION,
        },
        tempDir
      );

      const result = await executeRestore(provider, tempDir);

      expect(result.errors.length).toBeGreaterThan(0);

      const rows = await provider.getRows('accounts');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 1, name: 'Existing', balance: 100 });

      const cleanup = new pg.Client(TEST_CONFIG);
      await cleanup.connect();
      await cleanup.query('DROP TABLE accounts');
      await cleanup.end();
    });
  });

  describe('truncateTable', () => {
    it('does not cascade into unrelated child tables via FK', async () => {
      const setupClient = new pg.Client(TEST_CONFIG);
      await setupClient.connect();
      await setupClient.query(`
        DROP TABLE IF EXISTS children;
        DROP TABLE IF EXISTS parents;
        CREATE TABLE parents (id SERIAL PRIMARY KEY, name TEXT);
        CREATE TABLE children (
          id SERIAL PRIMARY KEY,
          parent_id INTEGER REFERENCES parents(id),
          name TEXT
        );
        INSERT INTO parents (name) VALUES ('p1');
        INSERT INTO children (parent_id, name) VALUES (1, 'c1');
      `);
      await setupClient.end();

      await provider.disableForeignKeys();
      await provider.truncateTable('parents');
      await provider.enableForeignKeys();

      const rows = await provider.getRows('children');
      expect(rows).toHaveLength(1);

      const cleanup = new pg.Client(TEST_CONFIG);
      await cleanup.connect();
      await cleanup.query('DROP TABLE children; DROP TABLE parents;');
      await cleanup.end();
    });
  });

  describe('identifiers containing characters that need escaping', () => {
    // A double quote is legal in a quoted Postgres identifier; interpolating
    // it without doubling closes the quoting early and yields invalid SQL.
    const TABLE = 'we"ird orders';
    const COLUMN = 'un"it';

    beforeEach(async () => {
      const setup = new pg.Client(TEST_CONFIG);
      await setup.connect();
      await setup.query(`CREATE TABLE "we""ird orders" (id SERIAL PRIMARY KEY, "un""it" TEXT)`);
      await setup.end();
    });

    afterEach(async () => {
      const cleanup = new pg.Client(TEST_CONFIG);
      await cleanup.connect();
      await cleanup.query(`DROP TABLE IF EXISTS "we""ird orders"`);
      await cleanup.end();
    });

    it('reads, writes and resets a table whose name contains a quote', async () => {
      expect(await provider.getPrimaryKeys(TABLE)).toEqual(['id']);
      expect((await provider.getColumns(TABLE)).map((c) => c.name)).toEqual(['id', COLUMN]);

      await provider.upsertRows(
        TABLE,
        [
          { name: 'id', type: 'integer' },
          { name: COLUMN, type: 'text' },
        ],
        ['id'],
        [{ id: 1, [COLUMN]: 'kg' }]
      );

      const rows = (await provider.getRows(TABLE)) as Record<string, unknown>[];
      expect(rows).toEqual([{ id: 1, [COLUMN]: 'kg' }]);

      await provider.resetSequences(TABLE);
      await provider.truncateTable(TABLE);
      expect(await provider.getRows(TABLE)).toHaveLength(0);
    });
  });

  describe('resetSequences', () => {
    it('advances the sequence past restored ids so the next insert does not collide', async () => {
      await provider.upsertRows(
        'users',
        [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'text' },
        ],
        ['id'],
        [{ id: 500, name: 'Restored' }]
      );

      await provider.resetSequences('users');

      const client = new pg.Client(TEST_CONFIG);
      await client.connect();
      // Would raise a duplicate-key error if the sequence still pointed at 3.
      const inserted = await client.query("INSERT INTO users (name) VALUES ('After') RETURNING id");
      await client.query('DELETE FROM users WHERE id >= 500');
      await client.end();

      expect(Number((inserted.rows[0] as { id: number }).id)).toBeGreaterThan(500);
    });

    it('surfaces a permission failure instead of swallowing it', async () => {
      // The failure the old bare `catch {}` hid: the sequence is left behind
      // the restored data, and the next insert fails with a duplicate key
      // long after the restore reported success.
      const admin = new pg.Client(TEST_CONFIG);
      await admin.connect();
      await admin.query(`DROP ROLE IF EXISTS db_restore_limited`);
      await admin.query(`CREATE ROLE db_restore_limited LOGIN PASSWORD 'limited'`);
      await admin.query(`GRANT CONNECT ON DATABASE ${TEST_DB} TO db_restore_limited`);
      await admin.query('GRANT USAGE ON SCHEMA public TO db_restore_limited');
      await admin.query('GRANT SELECT ON users TO db_restore_limited');
      await admin.end();

      const limited = new PostgresProvider();
      await limited.connect({
        ...TEST_CONFIG,
        user: 'db_restore_limited',
        password: 'limited',
      });

      // No USAGE on users_id_seq was granted, so setval is refused.
      const failure = await limited.resetSequences('users').catch((e: unknown) => e as Error);
      await limited.disconnect();

      const cleanup = new pg.Client(TEST_CONFIG);
      await cleanup.connect();
      await cleanup.query('DROP OWNED BY db_restore_limited');
      await cleanup.query('DROP ROLE db_restore_limited');
      await cleanup.end();

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/permission denied/i);
    });
  });

  it('upserts rows', async () => {
    const columns = [
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'text' },
      { name: 'email', type: 'text' },
    ];
    await provider.upsertRows(
      'users',
      columns,
      ['id'],
      [{ id: 1, name: 'Alice Updated', email: 'new@test.com' }]
    );
    const rows = await provider.getRows('users');
    const alice = rows.find((r) => (r as Record<string, unknown>)['id'] === 1) as Record<
      string,
      unknown
    >;
    expect(alice['name']).toBe('Alice Updated');
  });
});
