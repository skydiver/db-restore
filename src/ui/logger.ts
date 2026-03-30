import chalk from 'chalk';

export function success(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function warn(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function error(message: string, hint?: string): void {
  const [first, ...rest] = message.split('\n');
  console.log(chalk.red(`✗ Error: ${first}`));
  if (rest.length > 0) {
    console.log(chalk.gray(rest.join('\n')));
  }
  if (hint) {
    console.log(chalk.gray(`  Hint: ${hint}`));
  }
}

export function info(message: string): void {
  console.log(chalk.cyan(`ℹ ${message}`));
}
