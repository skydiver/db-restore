import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const CLI_SOURCE = join(import.meta.dirname, '..', 'src', 'cli.ts');

/**
 * `src/cli.ts` only calls `program.parse()` when it is the process entrypoint,
 * so that importing it from a test does not trigger a real CLI invocation.
 *
 * That guard has to survive how the CLI is *actually* installed: package
 * managers expose a `bin` entry as a symlink, and `import.meta.url` arrives
 * symlink-resolved and percent-encoded while `process.argv[1]` does not.
 * A naive string comparison silently produces a CLI that does nothing at all,
 * so each invocation path gets its own regression test.
 */
async function runCli(entrypoint: string): Promise<string> {
  const { stdout } = await run('npx', ['tsx', entrypoint, '--help'], {
    cwd: join(import.meta.dirname, '..'),
  });
  return stdout;
}

describe('CLI entrypoint detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-entrypoint-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses argv when invoked by its direct path', async () => {
    expect(await runCli(CLI_SOURCE)).toContain('Usage: db-restore');
  });

  it('parses argv when invoked through a symlink, as an installed bin is', async () => {
    const binLink = join(tempDir, 'db-restore');
    await symlink(CLI_SOURCE, binLink);

    expect(await runCli(binLink)).toContain('Usage: db-restore');
  });

  it('parses argv when the invocation path contains a space', async () => {
    const spacedDir = await mkdtemp(join(tmpdir(), 'db restore spaced '));
    try {
      const linked = join(spacedDir, 'db-restore');
      await symlink(CLI_SOURCE, linked);

      expect(await runCli(linked)).toContain('Usage: db-restore');
    } finally {
      await rm(spacedDir, { recursive: true, force: true });
    }
  });
});
