import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresProvider } from '../../src/providers/postgres.js';

const TEST_DB = 'db_restore_test';
const TEST_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: TEST_DB,
  user: 'postgres',
  password: 'postgres',
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

  it('gets primary keys', async () => {
    const pks = await provider.getPrimaryKeys('users');
    expect(pks).toEqual(['id']);
  });

  it('gets rows', async () => {
    const rows = await provider.getRows('users');
    expect(rows).toHaveLength(2);
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
