import mysql from 'mysql2/promise';
import type { Column, ConnectionConfig, DatabaseProvider } from './types.js';

export class MysqlProvider implements DatabaseProvider {
  private connection: mysql.Connection | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    this.connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
    });
  }

  async disconnect(): Promise<void> {
    await this.connection?.end();
    this.connection = null;
  }

  private getConnection(): mysql.Connection {
    if (!this.connection) throw new Error('Not connected');
    return this.connection;
  }

  async getTables(): Promise<string[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    );
    return (rows as { table_name: string }[]).map((r) => r.table_name);
  }

  async getColumns(table: string): Promise<Column[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND table_schema = DATABASE() ORDER BY ordinal_position',
      [table]
    );
    return (rows as { column_name: string; data_type: string }[]).map((r) => ({
      name: r.column_name,
      type: r.data_type,
    }));
  }

  async getPrimaryKeys(table: string): Promise<string[]> {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT column_name FROM information_schema.key_column_usage WHERE table_name = ? AND table_schema = DATABASE() AND constraint_name = 'PRIMARY'",
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
    await conn.query(`TRUNCATE TABLE \`${table}\``);
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

    for (const row of rows) {
      const values = colNames.map((c) => row[c] ?? null);
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

      await conn.query(sql, values);
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
}
