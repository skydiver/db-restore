import { describe, expect, it } from 'vitest';
import { getDefaultDumpDir } from '../src/constants.js';

describe('getDefaultDumpDir', () => {
  it('builds a dump dir path for an ordinary profile name', () => {
    expect(getDefaultDumpDir('myproject')).toContain('myproject');
  });

  it('rejects a traversing profile name', () => {
    expect(() => getDefaultDumpDir('../x')).toThrow();
  });
});
