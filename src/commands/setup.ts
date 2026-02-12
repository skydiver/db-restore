import { input, password as passwordPrompt, select } from '@inquirer/prompts';
import ora from 'ora';
import { profileExists, saveProfile } from '../config/profiles.js';
import { PROVIDER_DEFAULTS } from '../constants.js';
import type { AnyProfileConfig, Provider } from '../providers/types.js';
import * as logger from '../ui/logger.js';
import { askOverwrite } from '../utils/prompt.js';
import { buildConnectionConfig, createProvider } from '../utils/provider-factory.js';

export async function setupCommand(name: string): Promise<void> {
  // Check for existing profile
  if (await profileExists(name)) {
    const overwrite = await askOverwrite(name);
    if (!overwrite) {
      logger.info('Setup cancelled.');
      return;
    }
  }

  const provider = await select<Provider>({
    message: 'Provider:',
    choices: [
      { name: 'PostgreSQL', value: 'postgres' },
      { name: 'MySQL', value: 'mysql' },
      { name: 'SQLite', value: 'sqlite' },
    ],
  });

  let profile: AnyProfileConfig;

  if (provider === 'sqlite') {
    const path = await input({ message: 'Database file path:' });
    profile = { name, provider, path };
  } else {
    const defaults = PROVIDER_DEFAULTS[provider];
    const host = await input({ message: 'Host:', default: defaults.host });
    const portStr = await input({
      message: 'Port:',
      default: String(defaults.port),
    });
    const port = parseInt(portStr, 10);
    const database = await input({ message: 'Database:' });
    const user = await input({ message: 'User:', default: defaults.user });
    profile = { name, provider, host, port, database, user };
  }

  // Test connection
  const pw =
    profile.provider === 'sqlite' ? undefined : await passwordPrompt({ message: 'Password:' });

  const spinner = ora('Testing connection...').start();

  try {
    const dbProvider = await createProvider(profile.provider);
    const config = buildConnectionConfig(profile, pw);
    await dbProvider.connect(config);
    await dbProvider.disconnect();
    spinner.succeed('Connected.');
  } catch (err) {
    spinner.fail('Connection failed.');
    logger.error(
      err instanceof Error ? err.message : String(err),
      'Check your connection details and try again.'
    );
    return;
  }

  await saveProfile(profile);
  logger.success(`Profile "${name}" saved.`);
}
