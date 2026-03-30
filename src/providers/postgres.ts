import pg from 'pg';
import type { Column, ConnectionConfig, DatabaseProvider } from './types.js';

export class PostgresProvider implements DatabaseProvider {
  private client: pg.Client | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    this.client = new pg.Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
    });
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client?.end();
    this.client = null;
  }

  private getClient(): pg.Client {
    if (!this.client) throw new Error('Not connected');
    return this.client;
  }

  async getTables(): Promise<string[]> {
    const client = this.getClient();
    const result = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    return (result.rows as { tablename: string }[]).map((r) => r.tablename);
  }

  async getColumns(table: string): Promise<Column[]> {
    const client = this.getClient();
    const result = await client.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position',
      [table]
    );
    return (result.rows as { column_name: string; data_type: string }[]).map((r) => ({
      name: r.column_name,
      type: r.data_type,
    }));
  }

  async getPrimaryKeys(table: string): Promise<string[]> {
    const client = this.getClient();
    const result = await client.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`"${table}"`]
    );
    return (result.rows as { attname: string }[]).map((r) => r.attname);
  }

  async getRows(table: string): Promise<Record<string, unknown>[]> {
    const client = this.getClient();
    const result = await client.query(`SELECT * FROM "${table}"`);
    return result.rows as Record<string, unknown>[];
  }

  async truncateTable(table: string): Promise<void> {
    const client = this.getClient();
    await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
  }

  async upsertRows(
    table: string,
    columns: Column[],
    primaryKeys: string[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    const client = this.getClient();
    if (rows.length === 0) return;

    const colNames = columns.map((c) => c.name);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]!;
      const values = colNames.map((c) => row[c] ?? null);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const colList = colNames.map((c) => `"${c}"`).join(', ');

      let sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

      if (primaryKeys.length > 0) {
        const conflictCols = primaryKeys.map((k) => `"${k}"`).join(', ');
        const updateSet = colNames
          .filter((c) => !primaryKeys.includes(c))
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ');

        if (updateSet) {
          sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`;
        } else {
          sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
        }
      }

      try {
        await client.query(sql, values);
      } catch (err) {
        const original = err instanceof Error ? err.message : String(err);
        const details = this.buildErrorDetails(original, columns, values);
        throw new Error(
          `Restoring table "${table}" (row ${rowIndex}): ${original}${details}`
        );
      }
    }
  }

  private buildErrorDetails(message: string, columns: Column[], values: unknown[]): string {
    if (!message.toLowerCase().includes('json')) return '';

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!;
      const val = values[i];
      if (
        (col.type === 'json' || col.type === 'jsonb') &&
        val !== null &&
        val !== undefined &&
        (typeof val !== 'object' || Array.isArray(val))
      ) {
        const preview = this.formatValuePreview(val);
        const valType = Array.isArray(val) ? 'array' : typeof val;
        return `\n\n  Column: ${col.name} (${col.type})\n  Value:  ${preview} (${valType})`;
      }
    }
    return '';
  }

  private formatValuePreview(val: unknown): string {
    if (typeof val === 'string') {
      return val.length > 50 ? `"${val.slice(0, 50)}..."` : `"${val}"`;
    }
    if (Array.isArray(val)) {
      const str = JSON.stringify(val);
      return str.length > 50 ? `${str.slice(0, 50)}...` : str;
    }
    return String(val);
  }

  async resetSequences(table: string): Promise<void> {
    const client = this.getClient();
    const columns = await this.getColumns(table);

    for (const col of columns) {
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE(MAX("${col.name}"), 0) + 1, false) FROM "${table}"`,
          [`"${table}"`, col.name]
        );
      } catch {
        // Column doesn't have a sequence — skip silently
      }
    }
  }

  async disableForeignKeys(): Promise<void> {
    const client = this.getClient();
    await client.query("SET session_replication_role = 'replica'");
  }

  async enableForeignKeys(): Promise<void> {
    const client = this.getClient();
    await client.query("SET session_replication_role = 'origin'");
  }
}
