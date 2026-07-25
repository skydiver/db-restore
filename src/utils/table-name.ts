const SAFE_CHAR = /^[A-Za-z0-9_.-]$/;

function percentEncodeChar(char: string): string {
  const bytes = Buffer.from(char, 'utf-8');
  return Array.from(bytes)
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('');
}

/**
 * Turns an arbitrary database table name into a string safe to use as a
 * single filesystem path segment. Anything outside [A-Za-z0-9_.-] is
 * percent-encoded; a leading `-` (which a CLI could parse as an option) and
 * a bare `.` or `..` (which resolve to a directory rather than a file) are
 * escaped as well, and an empty result is rejected.
 */
export function toSafeFilename(table: string): string {
  if (table.length === 0) {
    throw new Error('Table name must not be empty');
  }

  let encoded = '';
  for (const char of table) {
    encoded += SAFE_CHAR.test(char) ? char : percentEncodeChar(char);
  }

  if (encoded.startsWith('-')) {
    encoded = `%2D${encoded.slice(1)}`;
  }

  if (encoded === '.') {
    encoded = '%2E';
  } else if (encoded === '..') {
    encoded = '%2E%2E';
  }

  if (encoded.length === 0) {
    throw new Error('Table name produces an empty filename');
  }

  return encoded;
}
