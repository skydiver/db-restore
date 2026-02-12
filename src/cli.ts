#!/usr/bin/env node
import { Command } from 'commander';
import ora from 'ora';
import { executeDump } from './commands/dump.js';
import { profilesCommand, removeCommand } from './commands/profiles.js';
import { executeRestore } from './commands/restore.js';
import { setupCommand } from './commands/setup.js';
import { loadProfile } from './config/profiles.js';
import { DEFAULT_DUMP_DIR } from './constants.js';
import { handleError } from './ui/errors.js';
import { printHeader } from './ui/header.js';
import * as logger from './ui/logger.js';
import { printTable } from './ui/table.js';
import { archiveDump } from './utils/archive.js';
import { dumpExists, readMetadata } from './utils/files.js';
import { askArchiveChoice, askPassword } from './utils/prompt.js';
import { buildConnectionConfig, createProvider } from './utils/provider-factory.js';

const program = new Command();

program
  .name('db-restore')
  .description('Database backup & restore for local development')
  .version('0.1.0')
  .hook('preAction', () => printHeader());

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
  .command('dump <name>')
  .description('Dump all tables to JSON')
  .option('--out <dir>', 'Output directory', DEFAULT_DUMP_DIR)
  .option('--verbose', 'Show detailed output', false)
  .action(async (name: string, opts: { out: string; verbose: boolean }) => {
    try {
      const profile = await loadProfile(name);

      const connectionInfo =
        profile.provider === 'sqlite'
          ? `${profile.provider} @ ${profile.path}`
          : `${profile.provider} @ ${profile.host}:${profile.port}/${profile.database}`;
      logger.info(`Profile: ${name} (${connectionInfo})`);

      // Handle previous dump
      if (await dumpExists(opts.out)) {
        const meta = await readMetadata(opts.out);
        logger.warn(`Previous dump found (${meta.timestamp}, ${meta.tables.length} tables)`);
        const choice = await askArchiveChoice();
        if (choice === 'cancel') {
          logger.info('Dump cancelled.');
          return;
        }
        if (choice === 'archive') {
          const archivePath = await archiveDump(opts.out);
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
      const result = await executeDump(provider, profile.provider, opts.out);
      dumpSpinner.succeed(`${result.tables.length} tables found.`);

      await provider.disconnect();

      // Summary table
      printTable({
        head: ['Table', 'Rows'],
        rows: result.tables.map((t) => [t.table, t.rowCount]),
        totalRow: ['Total', result.totalRows],
      });

      logger.success(`Dump saved to ${opts.out} (${result.tables.length} files)`);
    } catch (err) {
      handleError(err, { profile: name });
      process.exit(1);
    }
  });

program
  .command('restore <name>')
  .description('Restore tables from JSON dump')
  .option('--in <dir>', 'Input directory', DEFAULT_DUMP_DIR)
  .option('--verbose', 'Show detailed output', false)
  .action(async (name: string, opts: { in: string; verbose: boolean }) => {
    try {
      const profile = await loadProfile(name);

      const pw = profile.provider === 'sqlite' ? undefined : await askPassword();
      const spinner = ora('Connecting...').start();
      const provider = await createProvider(profile.provider);
      const config = buildConnectionConfig(profile, pw);
      await provider.connect(config);
      spinner.succeed('Connected.');

      const restoreSpinner = ora('Restoring...').start();
      const result = await executeRestore(provider, opts.in);
      restoreSpinner.succeed('Restore complete.');

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

      logger.success(
        `Restore complete (${result.totalRows} rows across ${result.tables.length} tables)`
      );
    } catch (err) {
      handleError(err, { profile: name });
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
