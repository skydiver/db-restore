// src/providers/postgres.ts
import pg from "pg";
var PostgresProvider = class {
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
  async getColumns(table) {
    const client = this.getClient();
    const result = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [table]
    );
    return result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type
    }));
  }
  async getPrimaryKeys(table) {
    const client = this.getClient();
    const result = await client.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`"${table}"`]
    );
    return result.rows.map((r) => r.attname);
  }
  async getRows(table) {
    const client = this.getClient();
    const result = await client.query(`SELECT * FROM "${table}"`);
    return result.rows;
  }
  async truncateTable(table) {
    const client = this.getClient();
    await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
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
      const values = colNames.map((c) => {
        const val = row[c] ?? null;
        if (jsonCols.has(c) && val !== null) return JSON.stringify(val);
        return val;
      });
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
      const colList = colNames.map((c) => `"${c}"`).join(", ");
      let sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;
      if (primaryKeys.length > 0) {
        const conflictCols = primaryKeys.map((k) => `"${k}"`).join(", ");
        const updateSet = colNames.filter((c) => !primaryKeys.includes(c)).map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
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
  buildErrorDetails(message, columns, values) {
    if (!message.toLowerCase().includes("json")) return "";
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const val = values[i];
      if ((col.type === "json" || col.type === "jsonb") && val !== null && val !== void 0 && (typeof val !== "object" || Array.isArray(val))) {
        const preview = this.formatValuePreview(val);
        const valType = Array.isArray(val) ? "array" : typeof val;
        return `

  Column: ${col.name} (${col.type})
  Value:  ${preview} (${valType})`;
      }
    }
    return "";
  }
  formatValuePreview(val) {
    if (typeof val === "string") {
      return val.length > 50 ? `"${val.slice(0, 50)}..."` : `"${val}"`;
    }
    if (Array.isArray(val)) {
      const str = JSON.stringify(val);
      return str.length > 50 ? `${str.slice(0, 50)}...` : str;
    }
    return String(val);
  }
  async resetSequences(table) {
    const client = this.getClient();
    const columns = await this.getColumns(table);
    for (const col of columns) {
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE(MAX("${col.name}"), 0) + 1, false) FROM "${table}"`,
          [`"${table}"`, col.name]
        );
      } catch {
      }
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
};
export {
  PostgresProvider
};
