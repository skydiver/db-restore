import { DUMP_FORMAT_VERSION } from '../constants.js';
import { decodeRow } from '../encoding/decode.js';
import type { Column, DatabaseProvider, TableDump } from '../providers/types.js';
import { chunk } from '../utils/batch.js';
import { describeError } from '../utils/error.js';
import { getTableFiles, readMetadata, readTableDump } from '../utils/files.js';

export interface RestoreResult {
  tables: { table: string; rowCount: number; strategy: 'upsert' | 'truncate' }[];
  totalRows: number;
  warnings: string[];
  errors: string[];
}

export async function executeRestore(
  provider: DatabaseProvider,
  inputDir: string
): Promise<RestoreResult> {
  const metadata = await readMetadata(inputDir);
  const activeProvider = provider.name;

  if (metadata.provider !== activeProvider) {
    throw new Error(
      `Dump was created with provider "${metadata.provider}" but the active profile uses ` +
        `"${activeProvider}". Restore aborted to avoid restoring incompatible data.`
    );
  }

  if (metadata.version !== DUMP_FORMAT_VERSION) {
    throw new Error(
      `Dump format version mismatch: dump was created with version ${metadata.version}, ` +
        `but this tool expects version ${DUMP_FORMAT_VERSION}. Restore aborted.`
    );
  }

  const tableFiles = await getTableFiles(inputDir);

  const result: RestoreResult = { tables: [], totalRows: 0, warnings: [], errors: [] };

  // Inside the try, so the finally below is guaranteed to re-enable foreign
  // keys once they have been disabled.
  try {
    await provider.disableForeignKeys();

    // The table list is identical for every iteration — querying it inside
    // the loop costs one information_schema round-trip per table.
    const currentTables = await provider.getTables();

    for (const file of tableFiles) {
      // Read before the per-table try so an unreadable file is reported
      // against its filename: the table name lives inside the file, and is
      // therefore unknown until the read succeeds. One corrupt file must
      // not stop the remaining tables from being restored.
      let dump: TableDump;
      try {
        dump = await readTableDump(file, inputDir);
      } catch (err) {
        result.errors.push(describeError(err));
        continue;
      }

      const tableName = dump.table;

      try {
        if (!currentTables.includes(tableName)) {
          result.warnings.push(
            `Table "${tableName}" from dump does not exist in database — skipped`
          );
          continue;
        }

        // Schema drift detection
        const currentColumns = await provider.getColumns(tableName);
        const currentColNames = new Set(currentColumns.map((c) => c.name));
        const dumpColNames = new Set(dump.columns.map((c) => c.name));

        const missingFromSchema = dump.columns.filter((c) => !currentColNames.has(c.name));
        if (missingFromSchema.length > 0) {
          // Only worth a round-trip once something is actually missing: a
          // generated column is absent from getColumns for a benign reason
          // (the database computes it), and must not be reported as removed.
          const generated = new Set(await provider.getGeneratedColumns(tableName));
          for (const col of missingFromSchema) {
            result.warnings.push(
              generated.has(col.name)
                ? `Skipping generated column "${col.name}" in table "${tableName}" — recomputed by the database`
                : `Skipping removed column "${col.name}" in table "${tableName}"`
            );
          }
        }

        // Built from the live schema, not the dump's recorded columns, so
        // the type string driving encoding decisions (e.g. json/jsonb
        // handling in upsertRows) always reflects the current database.
        const matchingColumns: Column[] = [];
        for (const col of currentColumns) {
          if (dumpColNames.has(col.name)) {
            matchingColumns.push(col);
          } else {
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
          // UPSERT in batches, atomically: a failure partway through must
          // not leave some rows of this table committed and others not.
          await provider.withTransaction(async () => {
            const batches = chunk(decodedRows);
            for (const batch of batches) {
              await provider.upsertRows(tableName, matchingColumns, currentPks, batch);
            }
          });
          result.tables.push({
            table: tableName,
            rowCount: decodedRows.length,
            strategy: 'upsert',
          });
        } else {
          // Fallback: TRUNCATE + INSERT, atomically — a failure partway
          // through must not leave the table truncated with only some rows
          // restored, losing the pre-existing data for nothing.
          result.warnings.push(
            `Table "${tableName}" has no primary key — using TRUNCATE + INSERT instead of UPSERT`
          );
          await provider.withTransaction(async () => {
            await provider.truncateTable(tableName);
            const batches = chunk(decodedRows);
            for (const batch of batches) {
              await provider.upsertRows(tableName, matchingColumns, [], batch);
            }
          });
          result.tables.push({
            table: tableName,
            rowCount: decodedRows.length,
            strategy: 'truncate',
          });
        }

        result.totalRows += decodedRows.length;
      } catch (err) {
        result.errors.push(describeError(err));
      }
    }

    // Reset sequences for all restored tables. A failure here is recorded
    // like any other per-table error: letting it propagate would throw away
    // the summary and the error list for a run that mostly succeeded.
    for (const entry of result.tables) {
      try {
        await provider.resetSequences(entry.table);
      } catch (err) {
        result.errors.push(`Resetting sequences for "${entry.table}": ${describeError(err)}`);
      }
    }
  } finally {
    await provider.enableForeignKeys();
  }

  return result;
}
