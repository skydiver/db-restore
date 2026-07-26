import { confirm, password, select } from '@inquirer/prompts';

export async function askPassword(): Promise<string> {
  return password({ message: 'Password:' });
}

export async function askArchiveChoice(): Promise<'archive' | 'discard' | 'cancel'> {
  return select({
    message: 'Previous dump found. What would you like to do?',
    choices: [
      { name: 'Archive (.tar.gz)', value: 'archive' as const },
      { name: 'Discard', value: 'discard' as const },
      { name: 'Cancel', value: 'cancel' as const },
    ],
  });
}

/**
 * `hadErrors` indicates the restore that just ran reported table failures.
 * In that case the dump directory is the only surviving copy of the data
 * the restore failed to write, so "Delete dump files" is omitted entirely
 * rather than merely de-emphasized. `Keep as-is` is always listed first so
 * a reflexive Enter (inquirer highlights choice[0]) never triggers deletion.
 */
export async function askPostRestoreChoice(
  hadErrors: boolean
): Promise<'delete' | 'archive' | 'keep'> {
  const choices = [
    { name: 'Keep as-is', value: 'keep' as const },
    { name: 'Archive (.tar.gz)', value: 'archive' as const },
    ...(hadErrors ? [] : [{ name: 'Delete dump files', value: 'delete' as const }]),
  ];

  return select({
    message: 'What would you like to do with the dump files?',
    choices,
  });
}

export async function askOverwrite(name: string): Promise<boolean> {
  return confirm({
    message: `Profile "${name}" already exists. Overwrite?`,
    default: false,
  });
}
