import pg from 'pg';
import { describeError } from '../utils/error.js';
import { buildJsonErrorDetails } from './json-error.js';
import type { Column, ConnectionConfig, DatabaseProvider } from './types.js';

/**
 * Quotes an identifier, doubling any embedded quote. Identifiers cannot be
 * parameterized, and a legal name such as `a"b` would otherwise close the
 * quoting early and produce invalid SQL.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class PostgresProvider implements DatabaseProvider {
  readonly name = 'postgres' as const;
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

  /**
   * Generated columns (`GENERATED ALWAYS AS (...) STORED`) are excluded: the
   * database computes them, and an INSERT naming one fails with "cannot
   * insert a non-DEFAULT value into column". They are derived from columns
   * that are dumped, so nothing is lost — the value is recomputed on restore.
   */
  async getColumns(table: string): Promise<Column[]> {
    const client = this.getClient();
    const result = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = $1 AND is_generated <> 'ALWAYS'
       ORDER BY ordinal_position`,
      [table]
    );
    return (result.rows as { column_name: string; data_type: string }[]).map((r) => ({
      name: r.column_name,
      type: r.data_type,
    }));
  }

  async getGeneratedColumns(table: string): Promise<string[]> {
    const client = this.getClient();
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND is_generated = 'ALWAYS'
       ORDER BY ordinal_position`,
      [table]
    );
    return (result.rows as { column_name: string }[]).map((r) => r.column_name);
  }

  async getPrimaryKeys(table: string): Promise<string[]> {
    const client = this.getClient();
    const result = await client.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [quoteIdent(table)]
    );
    return (result.rows as { attname: string }[]).map((r) => r.attname);
  }

  async getRows(table: string): Promise<Record<string, unknown>[]> {
    const client = this.getClient();
    const result = await client.query(`SELECT * FROM ${quoteIdent(table)}`);
    return result.rows as Record<string, unknown>[];
  }

  // DELETE FROM, not TRUNCATE ... CASCADE: TRUNCATE CASCADE silently empties
  // dependent tables that were never part of the restore, and TRUNCATE
  // requires an ACCESS EXCLUSIVE lock. DELETE FROM respects the disabled FK
  // triggers set up by disableForeignKeys() and only touches this table.
  async truncateTable(table: string): Promise<void> {
    const client = this.getClient();
    await client.query(`DELETE FROM ${quoteIdent(table)}`);
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
    const jsonCols = new Set(
      columns.filter((c) => c.type === 'json' || c.type === 'jsonb').map((c) => c.name)
    );

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]!;
      const rawValues = colNames.map((c) => row[c] ?? null);
      const values = rawValues.map((val, i) =>
        jsonCols.has(colNames[i]!) && val !== null ? JSON.stringify(val) : val
      );
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const colList = colNames.map(quoteIdent).join(', ');

      let sql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})`;

      if (primaryKeys.length > 0) {
        const conflictCols = primaryKeys.map(quoteIdent).join(', ');
        const updateSet = colNames
          .filter((c) => !primaryKeys.includes(c))
          .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
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
        // rawValues, not values: the latter has already had every JSON
        // column turned into a string, which would make the helper blame
        // the first JSON column unconditionally.
        const details = buildJsonErrorDetails(original, columns, rawValues);
        throw new Error(`Restoring table "${table}" (row ${rowIndex}): ${original}${details}`);
      }
    }
  }

  async resetSequences(table: string): Promise<void> {
    const client = this.getClient();
    const columns = await this.getColumns(table);
    const quotedTable = quoteIdent(table);

    for (const col of columns) {
      const lookup = await client.query('SELECT pg_get_serial_sequence($1, $2) AS sequence', [
        quotedTable,
        col.name,
      ]);
      const sequence = (lookup.rows[0] as { sequence: string | null } | undefined)?.sequence;
      if (!sequence) continue;

      await client.query(
        `SELECT setval($1, COALESCE(MAX(${quoteIdent(col.name)}), 0) + 1, false) FROM ${quotedTable}`,
        [sequence]
      );
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

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = this.getClient();
    await client.query('BEGIN');
    try {
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Never let a rollback failure hide the error that triggered it.
        throw new Error(`Rollback failed after: ${describeError(err)}`, { cause: rollbackErr });
      }
      throw err;
    }
  }
}
