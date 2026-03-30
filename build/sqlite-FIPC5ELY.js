// src/providers/sqlite.ts
import Database from "better-sqlite3";
var SqliteProvider = class {
  db = null;
  async connect(config) {
    this.db = new Database(config.path);
  }
  /** Test helper: inject an already-open database */
  connectWithDb(db) {
    this.db = db;
  }
  async disconnect() {
    this.db?.close();
    this.db = null;
  }
  getDb() {
    if (!this.db) throw new Error("Not connected");
    return this.db;
  }
  async getTables() {
    const db = this.getDb();
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    return rows.map((r) => r.name);
  }
  async getColumns(table) {
    const db = this.getDb();
    const rows = db.pragma(`table_info(${table})`);
    return rows.map((r) => ({ name: r.name, type: r.type }));
  }
  async getPrimaryKeys(table) {
    const db = this.getDb();
    const rows = db.pragma(`table_info(${table})`);
    return rows.filter((r) => r.pk > 0).map((r) => r.name);
  }
  async getRows(table) {
    const db = this.getDb();
    return db.prepare(`SELECT * FROM "${table}"`).all();
  }
  async truncateTable(table) {
    const db = this.getDb();
    db.exec(`DELETE FROM "${table}"`);
  }
  async upsertRows(table, columns, primaryKeys, rows) {
    const db = this.getDb();
    if (rows.length === 0) return;
    const colNames = columns.map((c) => c.name);
    const placeholders = colNames.map(() => "?").join(", ");
    const colList = colNames.map((c) => `"${c}"`).join(", ");
    let sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;
    if (primaryKeys.length > 0) {
      const conflictClause = primaryKeys.map((k) => `"${k}"`).join(", ");
      const updateSet = colNames.filter((c) => !primaryKeys.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(", ");
      if (updateSet) {
        sql += ` ON CONFLICT (${conflictClause}) DO UPDATE SET ${updateSet}`;
      } else {
        sql += ` ON CONFLICT (${conflictClause}) DO NOTHING`;
      }
    }
    const stmt = db.prepare(sql);
    const insertMany = db.transaction((rowsToInsert) => {
      for (let rowIndex = 0; rowIndex < rowsToInsert.length; rowIndex++) {
        const row = rowsToInsert[rowIndex];
        const values = colNames.map((c) => row[c] ?? null);
        try {
          stmt.run(...values);
        } catch (err) {
          const original = err instanceof Error ? err.message : String(err);
          throw new Error(`Restoring table "${table}" (row ${rowIndex}): ${original}`);
        }
      }
    });
    insertMany(rows);
  }
  async resetSequences(_table) {
  }
  async disableForeignKeys() {
    this.getDb().pragma("foreign_keys = OFF");
  }
  async enableForeignKeys() {
    this.getDb().pragma("foreign_keys = ON");
  }
};
export {
  SqliteProvider
};
