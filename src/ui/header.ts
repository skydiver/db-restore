import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

function getVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
      return pkg.version ?? '0.0.0';
    }
    dir = dirname(dir);
  }
  return '0.0.0';
}

export function printHeader(): void {
  const version = getVersion();
  const title = `db-restore v${version}`;
  const subtitle = 'Database backup & restore';
  const width = Math.max(title.length, subtitle.length) + 4;
  const pad = (s: string) => s.padEnd(width - 4);

  console.log(chalk.dim(`┌${'─'.repeat(width - 2)}┐`));
  console.log(chalk.dim('│') + `  ${chalk.bold(pad(title))}` + chalk.dim('│'));
  console.log(chalk.dim('│') + `  ${chalk.gray(pad(subtitle))}` + chalk.dim('│'));
  console.log(chalk.dim(`└${'─'.repeat(width - 2)}┘`));
  console.log();
}
