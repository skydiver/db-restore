import { describe, expect, it } from 'vitest';
import { decodeRow, decodeValue } from '../../src/encoding/decode.js';

describe('decodeValue', () => {
  it('passes through native JSON types', () => {
    expect(decodeValue(42)).toBe(42);
    expect(decodeValue('hello')).toBe('hello');
    expect(decodeValue(true)).toBe(true);
    expect(decodeValue(null)).toBe(null);
  });

  it('decodes bytes wrapper to Buffer', () => {
    const encoded = { __type: 'bytes', value: Buffer.from('hello').toString('base64') };
    const result = decodeValue(encoded);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).toString()).toBe('hello');
  });

  it('decodes bigint wrapper to BigInt', () => {
    const encoded = { __type: 'bigint', value: '9007199254740993' };
    expect(decodeValue(encoded)).toBe(BigInt('9007199254740993'));
  });

  it('decodes datetime wrapper to Date', () => {
    const encoded = { __type: 'datetime', value: '2026-01-15T10:30:00.000Z' };
    const result = decodeValue(encoded);
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('decodes json wrapper to plain object', () => {
    const nested = { foo: 'bar', count: 3 };
    const encoded = { __type: 'json', value: nested };
    expect(decodeValue(encoded)).toEqual(nested);
  });

  it('decodes decimal wrapper to string', () => {
    const encoded = { __type: 'decimal', value: '99.95' };
    expect(decodeValue(encoded)).toBe('99.95');
  });
});

describe('decodeRow', () => {
  it('decodes all wrapped values in a row', () => {
    const row = {
      id: 1,
      name: 'Alice',
      created: { __type: 'datetime', value: '2026-01-15T10:30:00.000Z' },
    };
    const decoded = decodeRow(row);
    expect(decoded['id']).toBe(1);
    expect(decoded['name']).toBe('Alice');
    expect(decoded['created']).toBeInstanceOf(Date);
  });
});
