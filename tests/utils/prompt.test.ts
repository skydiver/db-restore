import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SelectConfig {
  message: string;
  choices: { name: string; value: string }[];
}

const selectMock = vi.fn<(config: SelectConfig) => Promise<string>>();

function getLastSelectChoices(): SelectConfig['choices'] {
  const call = selectMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('select() was never called');
  }
  return call[0].choices;
}

vi.mock('@inquirer/prompts', () => ({
  select: selectMock,
  confirm: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
}));

const { askPostRestoreChoice } = await import('../../src/utils/prompt.js');

describe('askPostRestoreChoice', () => {
  beforeEach(() => {
    selectMock.mockReset();
    selectMock.mockResolvedValue('keep');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('puts the safe "keep as-is" choice first, so a reflexive Enter is safe', async () => {
    await askPostRestoreChoice(false);

    const choices = getLastSelectChoices();
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0]?.value).not.toBe('delete');
  });

  it('offers "delete" as a choice on a clean restore', async () => {
    await askPostRestoreChoice(false);

    const choices = getLastSelectChoices();
    expect(choices.some((c) => c.value === 'delete')).toBe(true);
  });

  it('omits "delete" entirely when the restore had errors', async () => {
    await askPostRestoreChoice(true);

    const choices = getLastSelectChoices();
    expect(choices.some((c) => c.value === 'delete')).toBe(false);
  });
});
