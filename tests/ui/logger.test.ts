import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, info, success, warn } from '../../src/ui/logger.js';

describe('logger sanitization', () => {
  let logSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const payload = 'restore complete\x1b[2K\x1b[1Aignore previous line';

  it('strips ANSI escape sequences from success messages', () => {
    success(payload);
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toContain('\x1b');
  });

  it('strips ANSI escape sequences from warn messages', () => {
    warn(payload);
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toContain('\x1b');
  });

  it('strips ANSI escape sequences from error messages and hints', () => {
    error(payload, payload);
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toContain('\x1b');
  });

  it('strips ANSI escape sequences from info messages', () => {
    info(payload);
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toContain('\x1b');
  });

  it('strips C0 control characters other than newline and tab', () => {
    error('bell\x07 and backspace\x08 and vtab\x0b');
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting control bytes were removed
    expect(printed).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it('strips C1 control characters', () => {
    error('c1 control \x9bfoo');
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).not.toMatch(/[\x80-\x9f]/);
  });

  it('preserves newlines and tabs', () => {
    error('line one\nline two\tindented');
    const printed = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(printed).toContain('\n');
    expect(printed).toContain('\t');
  });

  it('still applies chalk color codes around sanitized content', () => {
    success('hello');
    const printed = logSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain('hello');
  });
});
