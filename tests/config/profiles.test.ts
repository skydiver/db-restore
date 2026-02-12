import { mkdtemp, rm } from 'node:fs/promises';
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
});
