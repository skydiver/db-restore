// src/providers/mysql.ts
import { createConnection } from "mysql2/promise";
var MysqlProvider = class {
  connection = null;
  async connect(config) {
    this.connection = await createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password
    });
  }
  async disconnect() {
    await this.connection?.end();
    this.connection = null;
  }
  getConnection() {
    if (!this.connection) throw new Error("Not connected");
    return this.connection;
  }
  async getTables() {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    );
    return rows.map((r) => r.table_name);
  }
  async getColumns(table) {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND table_schema = DATABASE() ORDER BY ordinal_position",
      [table]
    );
    return rows.map((r) => ({
      name: r.column_name,
      type: r.data_type
    }));
  }
  async getPrimaryKeys(table) {
    const conn = this.getConnection();
    const [rows] = await conn.query(
      "SELECT column_name FROM information_schema.key_column_usage WHERE table_name = ? AND table_schema = DATABASE() AND constraint_name = 'PRIMARY'",
      [table]
    );
    return rows.map((r) => r.column_name);
  }
  async getRows(table) {
    const conn = this.getConnection();
    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    return rows;
  }
  async truncateTable(table) {
    const conn = this.getConnection();
    await conn.query(`TRUNCATE TABLE \`${table}\``);
  }
  async upsertRows(table, columns, primaryKeys, rows) {
    const conn = this.getConnection();
    if (rows.length === 0) return;
    const colNames = columns.map((c) => c.name);
    const jsonCols = new Set(
      columns.filter((c) => c.type === "json").map((c) => c.name)
    );
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const values = colNames.map((c) => {
        const val = row[c] ?? null;
        if (jsonCols.has(c) && val !== null) return JSON.stringify(val);
        return val;
      });
      const placeholders = values.map(() => "?").join(", ");
      const colList = colNames.map((c) => `\`${c}\``).join(", ");
      let sql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`;
      if (primaryKeys.length > 0) {
        const updateSet = colNames.filter((c) => !primaryKeys.includes(c)).map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ");
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
  async resetSequences(_table) {
  }
  async disableForeignKeys() {
    const conn = this.getConnection();
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  }
  async enableForeignKeys() {
    const conn = this.getConnection();
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  }
};
export {
  MysqlProvider
};
