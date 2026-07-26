import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/profiles.js', () => ({
  deleteProfile: vi.fn(),
  listProfiles: vi.fn(),
}));

const { deleteProfile } = await import('../../src/config/profiles.js');
const { removeCommand } = await import('../../src/commands/profiles.js');

describe('removeCommand', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.mocked(deleteProfile).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('propagates the failure instead of swallowing it when deleteProfile throws', async () => {
    vi.mocked(deleteProfile).mockRejectedValue(new Error('boom'));

    await expect(removeCommand('nope')).rejects.toThrow('boom');
  });

  it('resolves cleanly when deleteProfile succeeds', async () => {
    vi.mocked(deleteProfile).mockResolvedValue(undefined);

    await expect(removeCommand('myproject')).resolves.toBeUndefined();
  });
});
