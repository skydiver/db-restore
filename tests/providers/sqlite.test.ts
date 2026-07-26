import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../../src/providers/sqlite.js';

describe('SqliteProvider', () => {
  let db: Database.Database;
  let provider: SqliteProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        created_at TEXT
      );
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id)
      );
      CREATE TABLE _prisma_migrations (
        id TEXT PRIMARY KEY,
        migration_name TEXT
      );
      CREATE TABLE line_items (
        id INTEGER PRIMARY KEY,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total REAL GENERATED ALWAYS AS (quantity * unit_price) STORED
      );
      INSERT INTO line_items (id, quantity, unit_price) VALUES (1, 2, 10.0);
      INSERT INTO users (id, name, email, created_at) VALUES
        (1, 'Alice', 'alice@test.com', '2026-01-15T10:30:00.000Z'),
        (2, 'Bob', 'bob@test.com', '2026-01-16T11:00:00.000Z');
      INSERT INTO posts (id, title, user_id) VALUES
        (1, 'Hello World', 1),
        (2, 'Second Post', 2);
    `);
    provider = new SqliteProvider();
    provider.connectWithDb(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getTables', () => {
    it('returns user tables, excludes sqlite internals', async () => {
      const tables = await provider.getTables();
      expect(tables).toContain('users');
      expect(tables).toContain('posts');
      expect(tables).toContain('_prisma_migrations');
    });
  });

  describe('getColumns', () => {
    it('returns column names and types', async () => {
      const columns = await provider.getColumns('users');
      expect(columns).toEqual([
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' },
      ]);
    });

    it('excludes generated columns, which the database computes on write', async () => {
      const columns = await provider.getColumns('line_items');
      expect(columns.map((c) => c.name)).toEqual(['id', 'quantity', 'unit_price']);
    });

    it('upserts a row into a table that has a generated column', async () => {
      const columns = await provider.getColumns('line_items');

      await provider.upsertRows(
        'line_items',
        columns,
        ['id'],
        [{ id: 1, quantity: 3, unit_price: 20.0 }]
      );

      const rows = (await provider.getRows('line_items')) as Record<string, unknown>[];
      // Under safeIntegers mode, every INTEGER column reads back as BigInt.
      const row = rows.find((r) => r['id'] === 1n) as Record<string, unknown>;
      expect(row['total']).toBe(60);
    });
  });

  describe('getPrimaryKeys', () => {
    it('returns primary key columns', async () => {
      const pks = await provider.getPrimaryKeys('users');
      expect(pks).toEqual(['id']);
    });
  });

  describe('getRows', () => {
    it('returns all rows from a table', async () => {
      const rows = await provider.getRows('users');
      expect(rows).toHaveLength(2);
      // Under safeIntegers mode, INTEGER columns read back as BigInt — this
      // is what lets 64-bit values survive a round trip without precision
      // loss (see C5).
      expect(rows[0]).toEqual({
        id: 1n,
        name: 'Alice',
        email: 'alice@test.com',
        created_at: '2026-01-15T10:30:00.000Z',
      });
    });
  });

  describe('truncateTable', () => {
    it('removes all rows from a table', async () => {
      await provider.truncateTable('posts');
      const rows = await provider.getRows('posts');
      expect(rows).toHaveLength(0);
    });
  });

  describe('upsertRows', () => {
    it('inserts new rows', async () => {
      const columns = [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' },
      ];
      const rows = [
        {
          id: 3,
          name: 'Charlie',
          email: 'charlie@test.com',
          created_at: '2026-02-01T00:00:00.000Z',
        },
      ];
      await provider.upsertRows('users', columns, ['id'], rows);
      const allRows = await provider.getRows('users');
      expect(allRows).toHaveLength(3);
    });

    it('updates existing rows on conflict', async () => {
      const columns = [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' },
      ];
      const rows = [
        {
          id: 1,
          name: 'Alice Updated',
          email: 'newalice@test.com',
          created_at: '2026-01-15T10:30:00.000Z',
        },
      ];
      await provider.upsertRows('users', columns, ['id'], rows);
      const allRows = await provider.getRows('users');
      expect(allRows).toHaveLength(2);
      expect(allRows[0]).toMatchObject({
        id: 1n,
        name: 'Alice Updated',
        email: 'newalice@test.com',
      });
    });
  });

  describe('hostile table names', () => {
    const hostileTables = ['order items', 'a-b', 'order', 'select', 'a.b', 'a"b'];

    beforeEach(() => {
      for (const table of hostileTables) {
        const quoted = `"${table.replace(/"/g, '""')}"`;
        db.exec(`CREATE TABLE ${quoted} (id INTEGER PRIMARY KEY, name TEXT)`);
        db.prepare(`INSERT INTO ${quoted} (id, name) VALUES (1, 'x')`).run();
      }
    });

    it.each(hostileTables)('getColumns works for table named %j', async (table) => {
      const columns = await provider.getColumns(table);
      expect(columns.map((c) => c.name)).toEqual(['id', 'name']);
    });

    it.each(hostileTables)('getPrimaryKeys works for table named %j', async (table) => {
      const pks = await provider.getPrimaryKeys(table);
      expect(pks).toEqual(['id']);
    });
  });

  describe('FK toggling', () => {
    it('disables and enables foreign keys', async () => {
      await provider.disableForeignKeys();
      // Should be able to insert with invalid FK
      db.exec("INSERT INTO posts (id, title, user_id) VALUES (99, 'Invalid', 999)");
      await provider.enableForeignKeys();
    });
  });
});
