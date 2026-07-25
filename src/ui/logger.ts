import chalk from 'chalk';

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control bytes to strip them
const UNSAFE_CONTROL_CHARS = /[\x1b\x00-\x08\x0b\x0c\x0e-\x1f\x80-\x9f]/g;

/**
 * Strips ANSI/OSC escape sequences and non-printable control bytes from
 * driver-supplied text before it reaches the terminal. Newlines and tabs
 * are preserved. Applied at the sink (here) rather than at each caller, so
 * message paths added later inherit the guarantee.
 */
export function sanitize(s: string): string {
  return s.replace(UNSAFE_CONTROL_CHARS, '');
}

export function success(message: string): void {
  console.log(chalk.green(`✓ ${sanitize(message)}`));
}

export function warn(message: string): void {
  console.log(chalk.yellow(`⚠ ${sanitize(message)}`));
}

export function error(message: string, hint?: string): void {
  const [first, ...rest] = sanitize(message).split('\n');
  console.log(chalk.red(`✗ Error: ${first}`));
  if (rest.length > 0) {
    console.log(chalk.gray(rest.join('\n')));
  }
  if (hint) {
    console.log(chalk.gray(`  Hint: ${sanitize(hint)}`));
  }
}

export function info(message: string): void {
  console.log(chalk.cyan(`ℹ ${sanitize(message)}`));
}
