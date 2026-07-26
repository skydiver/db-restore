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

/**
 * Validates a profile name for use as a filesystem path segment (profile
 * JSON files, dump directories, archive filenames). Unlike `toSafeFilename`,
 * this REJECTS rather than rewrites: silently mangling `../../etc/foo` into
 * an encoded filename would create a confusing orphan profile instead of
 * surfacing the mistake (or attack) to the caller.
 */
export function assertSafeProfileName(name: string): string {
  if (name.length === 0) {
    throw new Error('Profile name must not be empty.');
  }

  const encoded = toSafeFilename(name);
  if (encoded !== name) {
    throw new Error(
      `Invalid profile name "${name}": only letters, numbers, "_", "-", and "." are allowed, and the name must not be "." or "..".`
    );
  }

  return name;
}
