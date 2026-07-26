import { type Connection, createConnection } from 'mysql2/promise';
import { describeError } from '../utils/error.js';
import type { Column, ConnectionConfig, DatabaseProvider } from './types.js';

export class MysqlProvider implements DatabaseProvider {
  readonly name = 'mysql' as const;
  private connection: Connection | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    this.connection = await createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      // Integers outside Number.MAX_SAFE_INTEGER come back as strings
      // instead of being silently rounded — bigNumberStrings stays false so
      // safe integers still read back as plain numbers.
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
  }

  async disconnect(): Promise<void> {
    await this.connection?.end();
    this.connection = null;
  }

  private getConnection(): Connection {
    if (!this.connection) throw new Error('Not connected');
    return this.connection;
  }

  /**
   * `information_schema` columns are aliased explicitly throughout this class:
   * MySQL 8 labels them uppercase (TABLE_NAME) in the result set, so reading
   * `row.table_name` without an alias yields undefined.
   */
  async getTables(): Promise<string[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    );
    return (rows as { table_name: string }[]).map((r) => r.table_name);
  }

  /**
   * Generated columns are excluded — MySQL rejects an INSERT that names one.
   * The filter tests `generation_expression` rather than `extra`, because
   * `extra` reads `DEFAULT_GENERATED` for ordinary columns with an expression
   * default (e.g. `CURRENT_TIMESTAMP`), which must still be restored.
   */
  async getColumns(table: string): Promise<Column[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      `SELECT column_name AS column_name, data_type AS data_type FROM information_schema.columns
       WHERE table_name = ? AND table_schema = DATABASE()
         AND (generation_expression IS NULL OR generation_expression = '')
       ORDER BY ordinal_position`,
      [table]
    );
    return (rows as { column_name: string; data_type: string }[]).map((r) => ({
      name: r.column_name,
      type: r.data_type,
    }));
  }

  /** Mirrors `getColumns`' filter, so the two can never disagree. */
  async getGeneratedColumns(table: string): Promise<string[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      `SELECT column_name AS column_name FROM information_schema.columns
       WHERE table_name = ? AND table_schema = DATABASE()
         AND generation_expression IS NOT NULL AND generation_expression <> ''
       ORDER BY ordinal_position`,
      [table]
    );
    return (rows as { column_name: string }[]).map((r) => r.column_name);
  }

  async getPrimaryKeys(table: string): Promise<string[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT column_name AS column_name FROM information_schema.key_column_usage WHERE table_name = ? AND table_schema = DATABASE() AND constraint_name = 'PRIMARY'",
      [table]
    );
    return (rows as { column_name: string }[]).map((r) => r.column_name);
  }

  async getRows(table: string): Promise<Record<string, unknown>[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    return rows as Record<string, unknown>[];
  }

  async truncateTable(table: string): Promise<void> {
    const conn = this.getConnection();
    // DELETE FROM, not TRUNCATE: MySQL's TRUNCATE causes an implicit COMMIT,
    // which would silently break any surrounding transaction. DELETE FROM
    // also respects disabled FK checks, unlike TRUNCATE ... CASCADE-style
    // behavior on other engines.
    await conn.query(`DELETE FROM \`${table}\``);
  }

  async upsertRows(
    table: string,
    columns: Column[],
    primaryKeys: string[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    const conn = this.getConnection();
    if (rows.length === 0) return;

    const colNames = columns.map((c) => c.name);
    const jsonCols = new Set(columns.filter((c) => c.type === 'json').map((c) => c.name));

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]!;
      const values = colNames.map((c) => {
        const val = row[c] ?? null;
        if (jsonCols.has(c) && val !== null) return JSON.stringify(val);
        return val;
      });
      const placeholders = values.map(() => '?').join(', ');
      const colList = colNames.map((c) => `\`${c}\``).join(', ');

      let sql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`;

      if (primaryKeys.length > 0) {
        const updateSet = colNames
          .filter((c) => !primaryKeys.includes(c))
          .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
          .join(', ');

        if (updateSet) {
          sql += ` ON DUPLICATE KEY UPDATE ${updateSet}`;
        }
      }

      try {
        await conn.query(sql, values);
      } catch (err) {
        const original = err instanceof Error ? err.message : String(err);
        throw new Error(`Restoring table "${table}" (row ${rowIndex}): ${original}`);
      }
    }
  }

  async resetSequences(_table: string): Promise<void> {
    // MySQL auto_increment resets automatically — no action needed
  }

  async disableForeignKeys(): Promise<void> {
    const conn = this.getConnection();
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  }

  async enableForeignKeys(): Promise<void> {
    const conn = this.getConnection();
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const conn = this.getConnection();
    await conn.beginTransaction();
    try {
      const result = await fn();
      await conn.commit();
      return result;
    } catch (err) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        // Never let a rollback failure hide the error that triggered it.
        throw new Error(`Rollback failed after: ${describeError(err)}`, { cause: rollbackErr });
      }
      throw err;
    }
  }
}
