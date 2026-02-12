interface TypeWrapper {
  __type: string;
  value: unknown;
}

export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'bigint') {
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

export function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    encoded[key] = encodeValue(value);
  }
  return encoded;
}
