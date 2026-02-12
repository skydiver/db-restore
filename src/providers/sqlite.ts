import Database from 'better-sqlite3';
import type { Column, DatabaseProvider, SqliteConfig } from './types.js';

export class SqliteProvider implements DatabaseProvider {
  private db: Database.Database | null = null;

  async connect(config: SqliteConfig): Promise<void> {
    this.db = new Database(config.path);
  }

  /** Test helper: inject an already-open database */
  connectWithDb(db: Database.Database): void {
    this.db = db;
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private getDb(): Database.Database {
    if (!this.db) throw new Error('Not connected');
    return this.db;
  }

  async getTables(): Promise<string[]> {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async getColumns(table: string): Promise<Column[]> {
    const db = this.getDb();
    const rows = db.pragma(`table_info(${table})`) as {
      name: string;
      type: string;
    }[];
    return rows.map((r) => ({ name: r.name, type: r.type }));
  }

  async getPrimaryKeys(table: string): Promise<string[]> {
    const db = this.getDb();
    const rows = db.pragma(`table_info(${table})`) as {
      name: string;
      pk: number;
    }[];
    return rows.filter((r) => r.pk > 0).map((r) => r.name);
  }

  async getRows(table: string): Promise<Record<string, unknown>[]> {
    const db = this.getDb();
    return db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  }

  async truncateTable(table: string): Promise<void> {
    const db = this.getDb();
    db.exec(`DELETE FROM "${table}"`);
  }

  async upsertRows(
    table: string,
    columns: Column[],
    primaryKeys: string[],
    rows: Record<string, unknown>[]
  ): Promise<void> {
    const db = this.getDb();
    if (rows.length === 0) return;

    const colNames = columns.map((c) => c.name);
    const placeholders = colNames.map(() => '?').join(', ');
    const colList = colNames.map((c) => `"${c}"`).join(', ');

    let sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

    if (primaryKeys.length > 0) {
      const conflictClause = primaryKeys.map((k) => `"${k}"`).join(', ');
      const updateSet = colNames
        .filter((c) => !primaryKeys.includes(c))
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(', ');

      if (updateSet) {
        sql += ` ON CONFLICT (${conflictClause}) DO UPDATE SET ${updateSet}`;
      } else {
        sql += ` ON CONFLICT (${conflictClause}) DO NOTHING`;
      }
    }

    const stmt = db.prepare(sql);
    const insertMany = db.transaction((rowsToInsert: Record<string, unknown>[]) => {
      for (const row of rowsToInsert) {
        const values = colNames.map((c) => row[c] ?? null);
        stmt.run(...values);
      }
    });

    insertMany(rows);
  }

  async resetSequences(_table: string): Promise<void> {
    // SQLite handles autoincrement automatically — no action needed
  }

  async disableForeignKeys(): Promise<void> {
    this.getDb().pragma('foreign_keys = OFF');
  }

  async enableForeignKeys(): Promise<void> {
    this.getDb().pragma('foreign_keys = ON');
  }
}
