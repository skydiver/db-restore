import { describe, expect, it } from 'vitest';
import { encodeRow, encodeValue } from '../../src/encoding/encode.js';

describe('encodeValue', () => {
  it('passes through native JSON types', () => {
    expect(encodeValue(42)).toBe(42);
    expect(encodeValue(3.14)).toBe(3.14);
    expect(encodeValue('hello')).toBe('hello');
    expect(encodeValue(true)).toBe(true);
    expect(encodeValue(null)).toBe(null);
  });

  it('encodes Buffer/Uint8Array as bytes', () => {
    const buf = Buffer.from('hello');
    expect(encodeValue(buf)).toEqual({
      __type: 'bytes',
      value: buf.toString('base64'),
    });
  });

  it('encodes BigInt as string', () => {
    expect(encodeValue(BigInt('9007199254740993'))).toEqual({
      __type: 'bigint',
      value: '9007199254740993',
    });
  });

  it('encodes Date as ISO string', () => {
    const date = new Date('2026-01-15T10:30:00.000Z');
    expect(encodeValue(date)).toEqual({
      __type: 'datetime',
      value: '2026-01-15T10:30:00.000Z',
    });
  });

  it('encodes plain objects as json', () => {
    const obj = { foo: 'bar', count: 3 };
    expect(encodeValue(obj)).toEqual({
      __type: 'json',
      value: obj,
    });
  });

  it('passes through arrays as-is', () => {
    const arr = [1, 2, 3];
    expect(encodeValue(arr)).toEqual([1, 2, 3]);
  });
});

describe('encodeRow', () => {
  it('encodes all values in a row', () => {
    const row = {
      id: 1,
      name: 'Alice',
      created: new Date('2026-01-15T10:30:00.000Z'),
      data: Buffer.from('binary'),
    };
    const encoded = encodeRow(row);
    expect(encoded['id']).toBe(1);
    expect(encoded['name']).toBe('Alice');
    expect(encoded['created']).toEqual({
      __type: 'datetime',
      value: '2026-01-15T10:30:00.000Z',
    });
    expect(encoded['data']).toEqual({
      __type: 'bytes',
      value: Buffer.from('binary').toString('base64'),
    });
  });
});
