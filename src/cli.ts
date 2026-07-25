#!/usr/bin/env node
import { Command } from 'commander';
import ora from 'ora';
import { executeDump } from './commands/dump.js';
import { profilesCommand, removeCommand } from './commands/profiles.js';
import { executeRestore } from './commands/restore.js';
import { setupCommand } from './commands/setup.js';
import { loadProfile, profileExists } from './config/profiles.js';
import { getDefaultDumpDir } from './constants.js';
import { handleError } from './ui/errors.js';
import { printHeader } from './ui/header.js';
import * as logger from './ui/logger.js';
import { printTable } from './ui/table.js';
import { archiveDump, deleteDump } from './utils/archive.js';
import { dumpExists, readMetadata } from './utils/files.js';
import { askArchiveChoice, askPassword, askPostRestoreChoice } from './utils/prompt.js';
import { buildConnectionConfig, createProvider } from './utils/provider-factory.js';

const program = new Command();

async function runDump(name: string, opts: { out?: string; verbose: boolean }): Promise<void> {
  const profile = await loadProfile(name);
  const outputDir = opts.out ?? getDefaultDumpDir(name);

  const connectionInfo =
    profile.provider === 'sqlite'
      ? `${profile.provider} @ ${profile.path}`
      : `${profile.provider} @ ${profile.host}:${profile.port}/${profile.database}`;
  logger.info(`Profile: ${name} (${connectionInfo})`);

  // Handle previous dump
  if (await dumpExists(outputDir)) {
    const meta = await readMetadata(outputDir);
    logger.warn(`Previous dump found (${meta.timestamp}, ${meta.tables.length} tables)`);
    const choice = await askArchiveChoice();
    if (choice === 'cancel') {
      logger.info('Dump cancelled.');
      return;
    }
    if (choice === 'archive') {
      const archivePath = await archiveDump(outputDir, name);
      logger.info(`Archived to ${archivePath}`);
    }
  }

  // Connect
  const pw = profile.provider === 'sqlite' ? undefined : await askPassword();
  const spinner = ora('Connecting...').start();
  const provider = await createProvider(profile.provider);
  const config = buildConnectionConfig(profile, pw);
  await provider.connect(config);
  spinner.succeed('Connected.');

  // Dump
  const dumpSpinner = ora('Dumping tables...').start();
  const result = await executeDump(provider, profile.provider, outputDir);
  dumpSpinner.succeed(`${result.tables.length} tables found.`);

  await provider.disconnect();

  // Summary table
  printTable({
    head: ['Table', 'Rows'],
    rows: result.tables.map((t) => [t.table, t.rowCount]),
    totalRow: ['Total', result.totalRows],
  });

  logger.success(`Dump saved to ${outputDir} (${result.tables.length} files)`);
}

async function runRestore(name: string, opts: { in?: string; verbose: boolean }): Promise<void> {
  const profile = await loadProfile(name);
  const inputDir = opts.in ?? getDefaultDumpDir(name);

  if (!(await dumpExists(inputDir))) {
    logger.error(`No dump found for profile "${name}".`, `Run first: db-restore ${name} dump`);
    return;
  }

  const pw = profile.provider === 'sqlite' ? undefined : await askPassword();
  const spinner = ora('Connecting...').start();
  const provider = await createProvider(profile.provider);
  const config = buildConnectionConfig(profile, pw);
  await provider.connect(config);
  spinner.succeed('Connected.');

  const restoreSpinner = ora('Restoring...').start();
  const result = await executeRestore(provider, inputDir);
  const hasErrors = result.errors.length > 0;
  if (hasErrors) {
    restoreSpinner.fail('Restore finished with errors.');
  } else {
    restoreSpinner.succeed('Restore complete.');
  }

  await provider.disconnect();

  // Summary table
  printTable({
    head: ['Table', 'Rows', 'Strategy'],
    rows: result.tables.map((t) => [t.table, t.rowCount, t.strategy]),
    totalRow: ['Total', result.totalRows, ''],
  });

  for (const warning of result.warnings) {
    logger.warn(warning);
  }

  for (const error of result.errors) {
    const [first, ...rest] = error.split('\n');
    const hint = rest.length > 0 ? rest.join('\n') : undefined;
    logger.error(first ?? error, hint);
  }

  if (hasErrors) {
    logger.info(
      `Partial restore: ${result.totalRows} rows across ${result.tables.length} tables (${result.errors.length} table(s) failed)`
    );
  } else {
    logger.success(
      `Restore complete (${result.totalRows} rows across ${result.tables.length} tables)`
    );
  }

  const postChoice = await askPostRestoreChoice();
  if (postChoice === 'delete') {
    await deleteDump(inputDir);
    logger.info('Dump files deleted.');
  } else if (postChoice === 'archive') {
    const archivePath = await archiveDump(inputDir, name);
    logger.info(`Archived to ${archivePath}`);
  }
}

program
  .name('db-restore')
  .description('Database backup & restore for local development')
  .version('1.2.1')
  .argument('[name]', 'profile name')
  .argument('[action]', 'action to run: dump or restore')
  .option('--out <dir>', 'Dump output directory (default: ~/.config/db-restore/dumps/<name>)')
  .option('--in <dir>', 'Restore input directory (default: ~/.config/db-restore/dumps/<name>)')
  .option('--verbose', 'Show detailed output', false)
  .hook('preAction', () => printHeader())
  .action(
    async (
      name: string | undefined,
      action: string | undefined,
      opts: { out?: string; in?: string; verbose: boolean }
    ) => {
      if (!name) {
        program.help();
        return;
      }

      try {
        if (!(await profileExists(name))) {
          logger.error(
            `Profile "${name}" not found.`,
            'Run "db-restore profiles" to list profiles, or "db-restore setup <name>" to create one.'
          );
          process.exit(1);
        }

        if (action === 'dump') {
          await runDump(name, opts);
        } else if (action === 'restore') {
          await runRestore(name, opts);
        } else if (!action) {
          logger.error(
            `No action specified for profile "${name}".`,
            `Run: db-restore ${name} dump  |  db-restore ${name} restore`
          );
          process.exit(1);
        } else {
          logger.error(
            `Unknown action "${action}".`,
            `Valid actions: dump, restore. Example: db-restore ${name} dump`
          );
          process.exit(1);
        }
      } catch (err) {
        handleError(err, { profile: name });
        process.exit(1);
      }
    }
  );

program
  .command('setup <name>')
  .description('Create a new database profile interactively')
  .action(async (name: string) => {
    try {
      await setupCommand(name);
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

program
  .command('profiles')
  .description('List all saved profiles')
  .action(async () => {
    try {
      await profilesCommand();
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

program
  .command('remove <name>')
  .description('Delete a profile')
  .action(async (name: string) => {
    try {
      await removeCommand(name);
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

program.parse();
