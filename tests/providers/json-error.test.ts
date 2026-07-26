import { describe, expect, it } from 'vitest';
import { buildJsonErrorDetails } from '../../src/providers/json-error.js';
import type { Column } from '../../src/providers/types.js';

const COLUMNS: Column[] = [
  { name: 'id', type: 'integer' },
  { name: 'settings', type: 'jsonb' },
  { name: 'tags', type: 'json' },
  { name: 'note', type: 'text' },
];

describe('buildJsonErrorDetails', () => {
  it('stays quiet for errors that have nothing to do with JSON', () => {
    expect(buildJsonErrorDetails('null value in column "note"', COLUMNS, [1, {}, {}, null])).toBe(
      ''
    );
  });

  it('names the JSON column whose value is not object-shaped', () => {
    const details = buildJsonErrorDetails('invalid input syntax for type json', COLUMNS, [
      1,
      { theme: 'dark' },
      'oops{',
      'note',
    ]);

    // `settings` holds a well-formed object and must be passed over —
    // blaming it was the old behaviour, because it inspected the values
    // after every JSON column had been stringified.
    expect(details).toContain('Column: tags (json)');
    expect(details).not.toContain('settings');
    expect(details).toContain('(string)');
  });

  it('reports an array element type as array', () => {
    const details = buildJsonErrorDetails('invalid input syntax for type json', COLUMNS, [
      1,
      [1, 2, 3],
      {},
      'note',
    ]);

    expect(details).toContain('Column: settings (jsonb)');
    expect(details).toContain('(array)');
    expect(details).toContain('[1,2,3]');
  });

  it('ignores null and undefined JSON values, which are legal', () => {
    expect(
      buildJsonErrorDetails('invalid input syntax for type json', COLUMNS, [
        1,
        null,
        undefined,
        'n',
      ])
    ).toBe('');
  });

  it('truncates a long preview instead of dumping the whole value', () => {
    const long = 'x'.repeat(200);
    const details = buildJsonErrorDetails('json error', COLUMNS, [1, long, {}, 'n']);

    expect(details).toContain('...');
    expect(details).not.toContain(long);
  });
});
