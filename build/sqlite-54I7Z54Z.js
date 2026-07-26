import {
  describeError
} from "./chunk-KY2R65TE.js";

// src/providers/sqlite.ts
import Database from "better-sqlite3";
var SqliteProvider = class {
  name = "sqlite";
  db = null;
  async connect(config) {
    this.db = new Database(config.path);
    this.db.defaultSafeIntegers(true);
  }
  /** Test helper: inject an already-open database */
  connectWithDb(db) {
    this.db = db;
    this.db.defaultSafeIntegers(true);
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
    const rows = db.pragma(`table_info("${table.replace(/"/g, '""')}")`);
    return rows.map((r) => ({ name: r.name, type: r.type }));
  }
  /**
   * `table_info` omits generated columns entirely, so the extended
   * `table_xinfo` pragma is needed to see them. Its `hidden` flag marks
   * VIRTUAL generated columns as 2 and STORED ones as 3.
   */
  async getGeneratedColumns(table) {
    const db = this.getDb();
    const rows = db.pragma(`table_xinfo("${table.replace(/"/g, '""')}")`);
    return rows.filter((r) => Number(r.hidden) === 2 || Number(r.hidden) === 3).map((r) => r.name);
  }
  async getPrimaryKeys(table) {
    const db = this.getDb();
    const rows = db.pragma(`table_info("${table.replace(/"/g, '""')}")`);
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
  async withTransaction(fn) {
    const db = this.getDb();
    db.exec("BEGIN");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        throw new Error(`Rollback failed after: ${describeError(err)}`, { cause: rollbackErr });
      }
      throw err;
    }
  }
};
export {
  SqliteProvider
};
