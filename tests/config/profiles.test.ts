import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProfile,
  listProfiles,
  loadProfile,
  profileExists,
  saveProfile,
} from '../../src/config/profiles.js';
import type { ServerProfileConfig, SqliteProfileConfig } from '../../src/providers/types.js';

describe('profiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'db-restore-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  const pgProfile: ServerProfileConfig = {
    name: 'myproject',
    provider: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'mydb',
    user: 'postgres',
  };

  const sqliteProfile: SqliteProfileConfig = {
    name: 'lite',
    provider: 'sqlite',
    path: './dev.db',
  };

  it('saves and loads a postgres profile', async () => {
    await saveProfile(pgProfile, tempDir);
    const loaded = await loadProfile('myproject', tempDir);
    expect(loaded).toEqual(pgProfile);
  });

  it('saves and loads a sqlite profile', async () => {
    await saveProfile(sqliteProfile, tempDir);
    const loaded = await loadProfile('lite', tempDir);
    expect(loaded).toEqual(sqliteProfile);
  });

  it('lists all profiles', async () => {
    await saveProfile(pgProfile, tempDir);
    await saveProfile(sqliteProfile, tempDir);
    const profiles = await listProfiles(tempDir);
    expect(profiles).toHaveLength(2);
    expect(profiles.map((p) => p.name).sort()).toEqual(['lite', 'myproject']);
  });

  it('returns empty array when no profiles exist', async () => {
    const profiles = await listProfiles(tempDir);
    expect(profiles).toEqual([]);
  });

  it('deletes a profile', async () => {
    await saveProfile(pgProfile, tempDir);
    expect(await profileExists('myproject', tempDir)).toBe(true);
    await deleteProfile('myproject', tempDir);
    expect(await profileExists('myproject', tempDir)).toBe(false);
  });

  it('throws when loading a non-existent profile', async () => {
    await expect(loadProfile('nope', tempDir)).rejects.toThrow();
  });

  describe('hostile profile names (path traversal)', () => {
    it('rejects saveProfile with a traversing name and creates no file outside the profiles dir', async () => {
      const victimDir = join(tempDir, 'outside');
      await mkdir(victimDir);
      const escapedName = `../outside/ESCAPED`;

      await expect(
        saveProfile({ ...pgProfile, name: escapedName }, join(tempDir, 'profiles'))
      ).rejects.toThrow();

      expect(existsSync(join(victimDir, 'ESCAPED.json'))).toBe(false);
    });

    it('rejects deleteProfile with a traversing name and does not unlink the victim file', async () => {
      const victimDir = join(tempDir, 'outside');
      await mkdir(victimDir);
      const victimFile = join(victimDir, 'some-file.json');
      await writeFile(victimFile, '{"victim":true}');

      await expect(
        deleteProfile('../outside/some-file', join(tempDir, 'profiles'))
      ).rejects.toThrow();

      expect(existsSync(victimFile)).toBe(true);
    });

    it('does not resolve an escaped path for profileExists', async () => {
      const victimDir = join(tempDir, 'outside');
      await mkdir(victimDir);
      await writeFile(join(victimDir, 'ESCAPED.json'), '{}');

      await expect(
        profileExists('../outside/ESCAPED', join(tempDir, 'profiles'))
      ).rejects.toThrow();
    });

    it('rejects loadProfile with a traversing name', async () => {
      await expect(loadProfile('../../../etc/passwd', tempDir)).rejects.toThrow();
    });
  });

  it.runIf(process.platform !== 'win32')(
    'creates the profiles directory and file with restrictive permissions',
    async () => {
      // Must not pre-exist: mkdtemp already creates dirs at 0700, so asserting
      // against it would pass even without the explicit mode.
      const profilesDir = join(tempDir, 'profiles');
      await saveProfile(pgProfile, profilesDir);

      const dirStat = await stat(profilesDir);
      const fileStat = await stat(join(profilesDir, `${pgProfile.name}.json`));

      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
  );

  it.runIf(process.platform !== 'win32')(
    'tightens a pre-existing profiles directory created with a looser mode',
    async () => {
      const profilesDir = join(tempDir, 'loose-profiles');
      await mkdir(profilesDir, { mode: 0o755 });

      await saveProfile(pgProfile, profilesDir);

      const dirStat = await stat(profilesDir);
      expect(dirStat.mode & 0o777).toBe(0o700);
    }
  );

  it.runIf(process.platform !== 'win32')(
    'restricts permissions even when overwriting an existing profile file',
    async () => {
      await saveProfile(pgProfile, tempDir);
      await saveProfile({ ...pgProfile, database: 'otherdb' }, tempDir);

      const fileStat = await stat(join(tempDir, `${pgProfile.name}.json`));
      expect(fileStat.mode & 0o777).toBe(0o600);
    }
  );
});
