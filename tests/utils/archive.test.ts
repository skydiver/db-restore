import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

// A not-yet-existing subdirectory: mkdtemp already creates dirs at 0700, so
// pointing ARCHIVE_DIR at the temp root would make the mode assertion pass
// even without the explicit mode on mkdir.
const mockArchiveDir = join(mkdtempSync(join(tmpdir(), 'db-restore-archive-dir-')), 'archive');

vi.mock('../../src/constants.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/constants.js')>();
  return { ...original, ARCHIVE_DIR: mockArchiveDir };
});

const { archiveDump } = await import('../../src/utils/archive.js');

describe('archiveDump', () => {
  let dumpDir: string;

  beforeEach(async () => {
    dumpDir = await mkdtemp(join(tmpdir(), 'db-restore-dumpdir-'));
  });

  afterEach(async () => {
    await rm(dumpDir, { recursive: true });
  });

  it('archives legitimate JSON dump files', async () => {
    await writeFile(join(dumpDir, 'users.json'), '{"table":"users"}');

    const archivePath = await archiveDump(dumpDir, 'legit-profile');
    const { stdout } = await execFileAsync('tar', ['-tzf', archivePath]);

    expect(stdout).toContain('users.json');
  });

  it('never passes a leading-dash filename to tar as an argv option', async () => {
    await writeFile(join(dumpDir, 'users.json'), '{"table":"users"}');
    await writeFile(join(dumpDir, '--checkpoint=1.json'), '{"table":"evil"}');

    const archivePath = await archiveDump(dumpDir, 'injection-profile');
    const { stdout } = await execFileAsync('tar', ['-tzf', archivePath]);

    expect(stdout).toContain('users.json');
    expect(stdout).not.toContain('--checkpoint=1.json');
  });

  it('leaves a rejected file untouched in the dump directory instead of silently consuming it', async () => {
    await writeFile(join(dumpDir, 'users.json'), '{"table":"users"}');
    await writeFile(join(dumpDir, '--checkpoint=1.json'), '{"table":"evil"}');

    await archiveDump(dumpDir, 'reject-profile');

    const remaining = await readFile(join(dumpDir, '--checkpoint=1.json'), 'utf-8');
    expect(remaining).toBe('{"table":"evil"}');
  });

  it.runIf(process.platform !== 'win32')(
    'creates the archive file with restrictive permissions',
    async () => {
      await writeFile(join(dumpDir, 'users.json'), '{"table":"users"}');

      const archivePath = await archiveDump(dumpDir, 'perms-profile');
      const archiveStat = await stat(archivePath);

      expect(archiveStat.mode & 0o777).toBe(0o600);
    }
  );

  it.runIf(process.platform !== 'win32')(
    'creates the archive directory with restrictive permissions',
    async () => {
      await writeFile(join(dumpDir, 'users.json'), '{"table":"users"}');

      await archiveDump(dumpDir, 'dir-perms-profile');
      const dirStat = await stat(mockArchiveDir);

      expect(dirStat.mode & 0o777).toBe(0o700);
    }
  );
});
