interface TypeWrapper {
  __type: string;
  value: unknown;
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'bigint') {
    // Safe-integer-range bigints (e.g. from better-sqlite3's safeIntegers
    // mode, which returns BigInt for every INTEGER column) are emitted as
    // plain JSON numbers to keep the dump format stable for the common
    // case. Only values outside Number.MAX_SAFE_INTEGER — where a plain
    // number would silently lose precision — keep the wrapper.
    if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) {
      return Number(value);
    }
    return { __type: 'bigint', value: value.toString() } satisfies TypeWrapper;
  }

  if (value instanceof Date) {
    return { __type: 'datetime', value: value.toISOString() } satisfies TypeWrapper;
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return { __type: 'bytes', value: buf.toString('base64') } satisfies TypeWrapper;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return { __type: 'json', value } satisfies TypeWrapper;
  }

  return value;
}

export function encodeRow(
  row: Record<string, unknown>,
  jsonColumns?: Set<string>
): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (jsonColumns?.has(key) && value !== null && value !== undefined) {
      encoded[key] = { __type: 'json', value } satisfies TypeWrapper;
    } else {
      encoded[key] = encodeValue(value);
    }
  }
  return encoded;
}
