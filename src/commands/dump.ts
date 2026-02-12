import { DUMP_FORMAT_VERSION, EXCLUDED_TABLES } from '../constants.js';
import { encodeRow } from '../encoding/encode.js';
import type { DatabaseProvider, DumpMetadata, TableDump } from '../providers/types.js';
import { writeMetadata, writeTableDump } from '../utils/files.js';

export interface DumpResult {
  tables: { table: string; rowCount: number }[];
  totalRows: number;
}

export async function executeDump(
  provider: DatabaseProvider,
  providerName: string,
  outputDir: string
): Promise<DumpResult> {
  const allTables = await provider.getTables();
  const tables = allTables.filter((t) => !EXCLUDED_TABLES.has(t));

  const result: DumpResult = { tables: [], totalRows: 0 };

  for (const table of tables) {
    const columns = await provider.getColumns(table);
    const primaryKeys = await provider.getPrimaryKeys(table);
    const rows = await provider.getRows(table);
    const encodedRows = rows.map(encodeRow);

    const dump: TableDump = {
      table,
      primaryKeys,
      columns,
      rows: encodedRows,
    };

    await writeTableDump(dump, outputDir);
    result.tables.push({ table, rowCount: rows.length });
    result.totalRows += rows.length;
  }

  const metadata: DumpMetadata = {
    provider: providerName,
    timestamp: new Date().toISOString(),
    tables,
    version: DUMP_FORMAT_VERSION,
  };

  await writeMetadata(metadata, outputDir);

  return result;
}
