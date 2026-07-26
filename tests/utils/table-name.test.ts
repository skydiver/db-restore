import { describe, expect, it } from 'vitest';
import { assertSafeProfileName, toSafeFilename } from '../../src/utils/table-name.js';

describe('toSafeFilename', () => {
  it('leaves an ordinary identifier untouched', () => {
    expect(toSafeFilename('users')).toBe('users');
  });

  it('percent-encodes path traversal sequences instead of stripping them', () => {
    const encoded = toSafeFilename('../../evil');
    expect(encoded).not.toContain('/');
    expect(encoded).toBe('..%2F..%2Fevil');
  });

  it('escapes a leading dash so it cannot be parsed as a CLI option', () => {
    const encoded = toSafeFilename('-rf');
    expect(encoded.startsWith('-')).toBe(false);
    expect(encoded).toBe('%2Drf');
  });

  it('percent-encodes a literal slash inside a name', () => {
    expect(toSafeFilename('a/b')).toBe('a%2Fb');
  });

  it('escapes a bare "." so it cannot resolve to the current directory', () => {
    expect(toSafeFilename('.')).toBe('%2E');
  });

  it('escapes a bare ".." so it cannot resolve to the parent directory', () => {
    expect(toSafeFilename('..')).toBe('%2E%2E');
  });

  it('percent-encodes unicode characters', () => {
    const encoded = toSafeFilename('café');
    expect(encoded).toBe('caf%C3%A9');
  });

  it('rejects an empty table name', () => {
    expect(() => toSafeFilename('')).toThrow();
  });

  it('produces distinct filenames for distinct table names (no collisions)', () => {
    const a = toSafeFilename('order items');
    const b = toSafeFilename('order_items');
    expect(a).not.toBe(b);
  });
});

describe('assertSafeProfileName', () => {
  it.each(['myproject', 'my-project', 'my_project.v2'])(
    'accepts an ordinary profile name %s unchanged',
    (name) => {
      expect(assertSafeProfileName(name)).toBe(name);
    }
  );

  it.each(['../../evil', '-rf', 'a/b', '.', '..', 'wéird'])(
    'rejects a hostile profile name %s instead of silently rewriting it',
    (name) => {
      expect(() => assertSafeProfileName(name)).toThrow();
    }
  );

  it('rejects an empty profile name', () => {
    expect(() => assertSafeProfileName('')).toThrow();
  });
});
