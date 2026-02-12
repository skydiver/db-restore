import { decodeRow } from '../encoding/decode.js';
import type { Column, DatabaseProvider } from '../providers/types.js';
import { chunk } from '../utils/batch.js';
import { getTableFiles, readMetadata, readTableDump } from '../utils/files.js';

export interface RestoreResult {
  tables: { table: string; rowCount: number; strategy: 'upsert' | 'truncate' }[];
  totalRows: number;
  warnings: string[];
}

export async function executeRestore(
  provider: DatabaseProvider,
  inputDir: string
): Promise<RestoreResult> {
  await readMetadata(inputDir);
  const tableNames = await getTableFiles(inputDir);

  const result: RestoreResult = { tables: [], totalRows: 0, warnings: [] };

  await provider.disableForeignKeys();

  try {
    for (const tableName of tableNames) {
      const dump = await readTableDump(tableName, inputDir);

      // Check if table exists in current DB
      const currentTables = await provider.getTables();
      if (!currentTables.includes(tableName)) {
        result.warnings.push(`Table "${tableName}" from dump does not exist in database — skipped`);
        continue;
      }

      // Schema drift detection
      const currentColumns = await provider.getColumns(tableName);
      const currentColNames = new Set(currentColumns.map((c) => c.name));
      const dumpColNames = new Set(dump.columns.map((c) => c.name));

      const matchingColumns: Column[] = [];
      for (const col of dump.columns) {
        if (currentColNames.has(col.name)) {
          matchingColumns.push(col);
        } else {
          result.warnings.push(`Skipping removed column "${col.name}" in table "${tableName}"`);
        }
      }

      for (const col of currentColumns) {
        if (!dumpColNames.has(col.name)) {
          result.warnings.push(
            `New column "${col.name}" in table "${tableName}" will use DB default`
          );
        }
      }

      // Decode rows, keeping only matching columns
      const decodedRows = dump.rows.map((row) => {
        const decoded = decodeRow(row);
        const filtered: Record<string, unknown> = {};
        for (const col of matchingColumns) {
          filtered[col.name] = decoded[col.name] ?? null;
        }
        return filtered;
      });

      // Determine strategy based on primary keys
      const currentPks = await provider.getPrimaryKeys(tableName);
      const hasPrimaryKey = currentPks.length > 0;

      if (hasPrimaryKey) {
        // UPSERT in batches
        const batches = chunk(decodedRows);
        for (const batch of batches) {
          await provider.upsertRows(tableName, matchingColumns, currentPks, batch);
        }
        result.tables.push({
          table: tableName,
          rowCount: decodedRows.length,
          strategy: 'upsert',
        });
      } else {
        // Fallback: TRUNCATE + INSERT
        result.warnings.push(
          `Table "${tableName}" has no primary key — using TRUNCATE + INSERT instead of UPSERT`
        );
        await provider.truncateTable(tableName);
        const batches = chunk(decodedRows);
        for (const batch of batches) {
          await provider.upsertRows(tableName, matchingColumns, [], batch);
        }
        result.tables.push({
          table: tableName,
          rowCount: decodedRows.length,
          strategy: 'truncate',
        });
      }

      result.totalRows += decodedRows.length;
    }

    // Reset sequences for all restored tables
    for (const entry of result.tables) {
      await provider.resetSequences(entry.table);
    }
  } finally {
    await provider.enableForeignKeys();
  }

  return result;
}
