interface TypeWrapper {
  __type: string;
  value: unknown;
}

function isTypeWrapper(value: unknown): value is TypeWrapper {
  return typeof value === 'object' && value !== null && '__type' in value && 'value' in value;
}

export function decodeValue(value: unknown): unknown {
  // Mirrors encodeValue's array handling. A `json`-wrapped array is not
  // affected: its payload is returned verbatim below, never walked.
  if (Array.isArray(value)) return value.map(decodeValue);

  if (!isTypeWrapper(value)) return value;

  switch (value.__type) {
    case 'bytes':
      return Buffer.from(value.value as string, 'base64');
    case 'bigint':
      return BigInt(value.value as string);
    case 'datetime':
      return new Date(value.value as string);
    case 'decimal':
      return value.value as string;
    case 'json':
      return value.value;
    default:
      return value.value;
  }
}

export function decodeRow(row: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    decoded[key] = decodeValue(value);
  }
  return decoded;
}
