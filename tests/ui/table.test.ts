import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printTable } from '../../src/ui/table.js';

describe('printTable sanitization', () => {
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // Table names come from provider.getTables() — the same untrusted DB-supplied
  // identifiers the dump path already treats as hostile.
  const hostileName = 'users\x1b[2K\x1b[1Aignored';

  it('strips escape sequences from row cells', () => {
    printTable({ head: ['Table', 'Rows'], rows: [[hostileName, 3]] });

    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toContain('\x1b');
    expect(printed).toContain('users');
  });

  it('strips escape sequences from headers and the total row', () => {
    printTable({
      head: [hostileName, 'Rows'],
      rows: [['users', 3]],
      totalRow: [hostileName, 3],
    });

    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toContain('\x1b');
  });
});
