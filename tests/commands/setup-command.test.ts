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

vi.mock('../../src/config/profiles.js', () => ({
  profileExists: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock('../../src/utils/provider-factory.js', () => ({
  createProvider: vi.fn(),
  buildConnectionConfig: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
}));

const { profileExists, saveProfile } = await import('../../src/config/profiles.js');
const { createProvider, buildConnectionConfig } = await import(
  '../../src/utils/provider-factory.js'
);
const { select, input, password } = await import('@inquirer/prompts');
const { setupCommand } = await import('../../src/commands/setup.js');

describe('setupCommand', () => {
  beforeEach(() => {
    vi.mocked(profileExists).mockResolvedValue(false);
    vi.mocked(saveProfile).mockResolvedValue(undefined);
    vi.mocked(select).mockResolvedValue('sqlite');
    vi.mocked(input).mockResolvedValue('./dev.db');
    vi.mocked(password).mockResolvedValue('secret');
    vi.mocked(buildConnectionConfig).mockReturnValue({ path: './dev.db' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('propagates a connection failure instead of exiting cleanly', async () => {
    vi.mocked(createProvider).mockResolvedValue({
      connect: vi.fn().mockRejectedValue(new Error('connection refused')),
      disconnect: vi.fn(),
    } as never);

    await expect(setupCommand('myproject')).rejects.toThrow('connection refused');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('rejects a hostile profile name before doing any work', async () => {
    await expect(setupCommand('../../evil')).rejects.toThrow();
    expect(profileExists).not.toHaveBeenCalled();
  });
});
