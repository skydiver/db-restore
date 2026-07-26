import type { Column } from './types.js';

const MAX_PREVIEW_LENGTH = 50;

function formatValuePreview(val: unknown): string {
  if (typeof val === 'string') {
    return val.length > MAX_PREVIEW_LENGTH
      ? `"${val.slice(0, MAX_PREVIEW_LENGTH)}..."`
      : `"${val}"`;
  }
  if (Array.isArray(val)) {
    const str = JSON.stringify(val);
    return str.length > MAX_PREVIEW_LENGTH ? `${str.slice(0, MAX_PREVIEW_LENGTH)}...` : str;
  }
  return String(val);
}

/**
 * Points at the JSON-typed column whose value is not shaped like JSON, to
 * turn a driver's generic "invalid input syntax for type json" into
 * something actionable.
 *
 * `values` must be the values as they came from the dump, not the ones
 * already handed to the driver: providers stringify JSON columns before
 * binding, and against those every JSON column looks like a plain string,
 * so the first one would always be blamed.
 */
export function buildJsonErrorDetails(
  message: string,
  columns: Column[],
  values: unknown[]
): string {
  if (!message.toLowerCase().includes('json')) return '';

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    const val = values[i];
    const isJsonColumn = col.type === 'json' || col.type === 'jsonb';
    const looksLikeJson = typeof val === 'object' && !Array.isArray(val);

    if (isJsonColumn && val !== null && val !== undefined && !looksLikeJson) {
      const preview = formatValuePreview(val);
      const valType = Array.isArray(val) ? 'array' : typeof val;
      return `\n\n  Column: ${col.name} (${col.type})\n  Value:  ${preview} (${valType})`;
    }
  }
  return '';
}
