import {
  describeError
} from "./chunk-KY2R65TE.js";

// src/providers/postgres.ts
import pg from "pg";

// src/providers/json-error.ts
var MAX_PREVIEW_LENGTH = 50;
function formatValuePreview(val) {
  if (typeof val === "string") {
    return val.length > MAX_PREVIEW_LENGTH ? `"${val.slice(0, MAX_PREVIEW_LENGTH)}..."` : `"${val}"`;
  }
  if (Array.isArray(val)) {
    const str = JSON.stringify(val);
    return str.length > MAX_PREVIEW_LENGTH ? `${str.slice(0, MAX_PREVIEW_LENGTH)}...` : str;
  }
  return String(val);
}
function buildJsonErrorDetails(message, columns, values) {
  if (!message.toLowerCase().includes("json")) return "";
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const val = values[i];
    const isJsonColumn = col.type === "json" || col.type === "jsonb";
    const looksLikeJson = typeof val === "object" && !Array.isArray(val);
    if (isJsonColumn && val !== null && val !== void 0 && !looksLikeJson) {
      const preview = formatValuePreview(val);
      const valType = Array.isArray(val) ? "array" : typeof val;
      return `

  Column: ${col.name} (${col.type})
  Value:  ${preview} (${valType})`;
    }
  }
  return "";
}

// src/providers/postgres.ts
function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}
var PostgresProvider = class {
  name = "postgres";
  client = null;
  async connect(config) {
    this.client = new pg.Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password
    });
    await this.client.connect();
  }
  async disconnect() {
    await this.client?.end();
    this.client = null;
  }
  getClient() {
    if (!this.client) throw new Error("Not connected");
    return this.client;
  }
  async getTables() {
    const client = this.getClient();
    const result = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    return result.rows.map((r) => r.tablename);
  }
  /**
   * Generated columns (`GENERATED ALWAYS AS (...) STORED`) are excluded: the
   * database computes them, and an INSERT naming one fails with "cannot
   * insert a non-DEFAULT value into column". They are derived from columns
   * that are dumped, so nothing is lost — the value is recomputed on restore.
   */
  async getColumns(table) {
    const client = this.getClient();
    const result = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = $1 AND is_generated <> 'ALWAYS'
       ORDER BY ordinal_position`,
      [table]
    );
    return result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type
    }));
  }
  async getGeneratedColumns(table) {
    const client = this.getClient();
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND is_generated = 'ALWAYS'
       ORDER BY ordinal_position`,
      [table]
    );
    return result.rows.map((r) => r.column_name);
  }
  async getPrimaryKeys(table) {
    const client = this.getClient();
    const result = await client.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [quoteIdent(table)]
    );
    return result.rows.map((r) => r.attname);
  }
  async getRows(table) {
    const client = this.getClient();
    const result = await client.query(`SELECT * FROM ${quoteIdent(table)}`);
    return result.rows;
  }
  // DELETE FROM, not TRUNCATE ... CASCADE: TRUNCATE CASCADE silently empties
  // dependent tables that were never part of the restore, and TRUNCATE
  // requires an ACCESS EXCLUSIVE lock. DELETE FROM respects the disabled FK
  // triggers set up by disableForeignKeys() and only touches this table.
  async truncateTable(table) {
    const client = this.getClient();
    await client.query(`DELETE FROM ${quoteIdent(table)}`);
  }
  async upsertRows(table, columns, primaryKeys, rows) {
    const client = this.getClient();
    if (rows.length === 0) return;
    const colNames = columns.map((c) => c.name);
    const jsonCols = new Set(
      columns.filter((c) => c.type === "json" || c.type === "jsonb").map((c) => c.name)
    );
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rawValues = colNames.map((c) => row[c] ?? null);
      const values = rawValues.map(
        (val, i) => jsonCols.has(colNames[i]) && val !== null ? JSON.stringify(val) : val
      );
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
      const colList = colNames.map(quoteIdent).join(", ");
      let sql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})`;
      if (primaryKeys.length > 0) {
        const conflictCols = primaryKeys.map(quoteIdent).join(", ");
        const updateSet = colNames.filter((c) => !primaryKeys.includes(c)).map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ");
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
        const details = buildJsonErrorDetails(original, columns, rawValues);
        throw new Error(`Restoring table "${table}" (row ${rowIndex}): ${original}${details}`);
      }
    }
  }
  async resetSequences(table) {
    const client = this.getClient();
    const columns = await this.getColumns(table);
    const quotedTable = quoteIdent(table);
    for (const col of columns) {
      const lookup = await client.query("SELECT pg_get_serial_sequence($1, $2) AS sequence", [
        quotedTable,
        col.name
      ]);
      const sequence = lookup.rows[0]?.sequence;
      if (!sequence) continue;
      await client.query(
        `SELECT setval($1, COALESCE(MAX(${quoteIdent(col.name)}), 0) + 1, false) FROM ${quotedTable}`,
        [sequence]
      );
    }
  }
  async disableForeignKeys() {
    const client = this.getClient();
    await client.query("SET session_replication_role = 'replica'");
  }
  async enableForeignKeys() {
    const client = this.getClient();
    await client.query("SET session_replication_role = 'origin'");
  }
  async withTransaction(fn) {
    const client = this.getClient();
    await client.query("BEGIN");
    try {
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        throw new Error(`Rollback failed after: ${describeError(err)}`, { cause: rollbackErr });
      }
      throw err;
    }
  }
};
export {
  PostgresProvider
};
