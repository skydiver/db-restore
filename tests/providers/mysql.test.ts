import { createConnection } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MysqlProvider } from '../../src/providers/mysql.js';

const TEST_DB = 'db_restore_test';
// Overridable so the suite can run against any local MySQL — see
// docker-compose.test.yml and the `test:db` script.
const TEST_CONFIG = {
  host: process.env['MYSQL_HOST'] ?? 'localhost',
  port: Number(process.env['MYSQL_PORT'] ?? 3306),
  database: TEST_DB,
  user: process.env['MYSQL_USER'] ?? 'root',
  password: process.env['MYSQL_PASSWORD'] ?? 'mysql',
};

// `exactOptionalPropertyTypes` rules out spreading `database: undefined`, so
// the server-level (no database selected) config is built explicitly.
const { database: _db, ...ADMIN_CONFIG } = TEST_CONFIG;

async function isMysqlAvailable(): Promise<boolean> {
  try {
    const conn = await createConnection(ADMIN_CONFIG);
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

const mysqlAvailable = await isMysqlAvailable();

describe.skipIf(!mysqlAvailable)('MysqlProvider', () => {
  let provider: MysqlProvider;

  beforeAll(async () => {
    const admin = await createConnection(ADMIN_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.query(`CREATE DATABASE \`${TEST_DB}\``);
    await admin.end();

    const setup = await createConnection(TEST_CONFIG);
    await setup.query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255)
      )
    `);
    await setup.query("INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com')");
    await setup.query("INSERT INTO users (name, email) VALUES ('Bob', 'bob@test.com')");

    // `created_at` has an expression default, which MySQL reports in `extra`
    // as DEFAULT_GENERATED — it is NOT a generated column and must still be
    // dumped and restored. `total` is the real generated column.
    await setup.query(`
      CREATE TABLE line_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quantity INT NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total DECIMAL(12, 2) AS (quantity * unit_price) STORED
      )
    `);
    await setup.query('INSERT INTO line_items (quantity, unit_price) VALUES (2, 10.00)');
    await setup.end();
  });

  afterAll(async () => {
    const admin = await createConnection(ADMIN_CONFIG);
    await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await admin.end();
  });

  beforeEach(async () => {
    provider = new MysqlProvider();
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

  it('gets primary keys', async () => {
    const pks = await provider.getPrimaryKeys('users');
    expect(pks).toEqual(['id']);
  });

  it('gets rows', async () => {
    const rows = await provider.getRows('users');
    expect(rows).toHaveLength(2);
  });

  it('upserts rows', async () => {
    const columns = await provider.getColumns('users');

    await provider.upsertRows(
      'users',
      columns,
      ['id'],
      [{ id: 1, name: 'Alice Updated', email: 'new@test.com' }]
    );

    const rows = (await provider.getRows('users')) as Record<string, unknown>[];
    const alice = rows.find((r) => r['id'] === 1) as Record<string, unknown>;
    expect(alice['name']).toBe('Alice Updated');
  });

  it('excludes generated columns, which the database computes and refuses inserts into', async () => {
    const columns = await provider.getColumns('line_items');
    expect(columns.map((c) => c.name)).toEqual(['id', 'quantity', 'unit_price', 'created_at']);
  });

  it('upserts a row into a table that has a generated column', async () => {
    const columns = await provider.getColumns('line_items');

    await provider.upsertRows(
      'line_items',
      columns,
      ['id'],
      [{ id: 1, quantity: 3, unit_price: '20.00', created_at: '2026-01-01 00:00:00' }]
    );

    const rows = (await provider.getRows('line_items')) as Record<string, unknown>[];
    const row = rows.find((r) => r['id'] === 1) as Record<string, unknown>;
    expect(row['quantity']).toBe(3);
    // Recomputed by the database, not restored from the dump.
    expect(Number(row['total'])).toBe(60);
  });
});
