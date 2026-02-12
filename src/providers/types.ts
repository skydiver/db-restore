export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SqliteConfig {
  path: string;
}

export interface Column {
  name: string;
  type: string;
}

export interface TableDump {
  table: string;
  primaryKeys: string[];
  columns: Column[];
  rows: Record<string, unknown>[];
}

export interface DumpMetadata {
  provider: string;
  timestamp: string;
  tables: string[];
  version: number;
}

export interface DatabaseProvider {
  connect(config: ConnectionConfig | SqliteConfig): Promise<void>;
  disconnect(): Promise<void>;
  getTables(): Promise<string[]>;
  getColumns(table: string): Promise<Column[]>;
  getPrimaryKeys(table: string): Promise<string[]>;
  getRows(table: string): Promise<Record<string, unknown>[]>;
  truncateTable(table: string): Promise<void>;
  upsertRows(
    table: string,
    columns: Column[],
    primaryKeys: string[],
    rows: Record<string, unknown>[]
  ): Promise<void>;
  resetSequences(table: string): Promise<void>;
  disableForeignKeys(): Promise<void>;
  enableForeignKeys(): Promise<void>;
}

export type Provider = 'postgres' | 'mysql' | 'sqlite';

export interface ProfileConfig {
  name: string;
  provider: Provider;
}

export interface ServerProfileConfig extends ProfileConfig {
  provider: 'postgres' | 'mysql';
  host: string;
  port: number;
  database: string;
  user: string;
}

export interface SqliteProfileConfig extends ProfileConfig {
  provider: 'sqlite';
  path: string;
}

export type AnyProfileConfig = ServerProfileConfig | SqliteProfileConfig;
