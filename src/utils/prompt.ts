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

export async function askOverwrite(name: string): Promise<boolean> {
  return confirm({
    message: `Profile "${name}" already exists. Overwrite?`,
    default: false,
  });
}
