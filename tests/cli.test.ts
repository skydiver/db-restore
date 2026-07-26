import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ora writes its spinner frames straight to stderr, which vitest's console
// interception does not capture — stub it so a passing run stays quiet.
vi.mock('ora', () => {
  const spinner = {
    start: vi.fn(() => spinner),
    succeed: vi.fn(() => spinner),
    fail: vi.fn(() => spinner),
    stop: vi.fn(() => spinner),
  };
  return { default: vi.fn(() => spinner) };
});

vi.mock('../src/config/profiles.js', () => ({
  loadProfile: vi.fn(),
  profileExists: vi.fn(),
}));

vi.mock('../src/utils/files.js', () => ({
  dumpExists: vi.fn(),
  readMetadata: vi.fn(),
}));

vi.mock('../src/commands/restore.js', () => ({
  executeRestore: vi.fn(),
}));

vi.mock('../src/utils/provider-factory.js', () => ({
  createProvider: vi.fn(),
  buildConnectionConfig: vi.fn(),
}));

vi.mock('../src/utils/prompt.js', () => ({
  askPassword: vi.fn(),
  askPostRestoreChoice: vi.fn(),
  askArchiveChoice: vi.fn(),
}));

vi.mock('../src/utils/archive.js', () => ({
  archiveDump: vi.fn(),
  deleteDump: vi.fn(),
}));

const { loadProfile } = await import('../src/config/profiles.js');
const { dumpExists } = await import('../src/utils/files.js');
const { executeRestore } = await import('../src/commands/restore.js');
const { createProvider, buildConnectionConfig } = await import('../src/utils/provider-factory.js');
const { askPostRestoreChoice } = await import('../src/utils/prompt.js');
const { runRestore } = await import('../src/cli.js');

describe('runRestore exit code', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.mocked(loadProfile).mockResolvedValue({
      name: 'test',
      provider: 'sqlite',
      path: './dev.db',
    });
    vi.mocked(dumpExists).mockResolvedValue(true);
    vi.mocked(createProvider).mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as never);
    vi.mocked(buildConnectionConfig).mockReturnValue({ path: './dev.db' });
    vi.mocked(askPostRestoreChoice).mockResolvedValue('keep');
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.clearAllMocks();
  });

  it('sets a non-zero exit code when the restore result contains errors', async () => {
    vi.mocked(executeRestore).mockResolvedValue({
      tables: [],
      totalRows: 0,
      warnings: [],
      errors: ['table "orders" failed'],
    });

    await runRestore('test', { in: '/tmp/dump', verbose: false });

    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit code untouched after a clean restore', async () => {
    vi.mocked(executeRestore).mockResolvedValue({
      tables: [],
      totalRows: 0,
      warnings: [],
      errors: [],
    });

    await runRestore('test', { in: '/tmp/dump', verbose: false });

    expect(process.exitCode).toBeUndefined();
  });

  it('omits the "delete" choice from the post-restore prompt when the restore had errors', async () => {
    vi.mocked(executeRestore).mockResolvedValue({
      tables: [],
      totalRows: 0,
      warnings: [],
      errors: ['table "orders" failed'],
    });

    await runRestore('test', { in: '/tmp/dump', verbose: false });

    expect(askPostRestoreChoice).toHaveBeenCalledWith(true);
  });
});
