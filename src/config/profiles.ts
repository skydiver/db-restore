import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_BASE_DIR } from '../constants.js';
import type { AnyProfileConfig } from '../providers/types.js';

function resolveDir(configDir?: string): string {
  if (configDir) return configDir;
  return join(CONFIG_BASE_DIR, 'profiles');
}

export async function saveProfile(profile: AnyProfileConfig, configDir?: string): Promise<void> {
  const dir = resolveDir(configDir);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${profile.name}.json`);
  await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

export async function loadProfile(name: string, configDir?: string): Promise<AnyProfileConfig> {
  const dir = resolveDir(configDir);
  const filePath = join(dir, `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Profile "${name}" not found`);
  }
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as AnyProfileConfig;
}

export async function listProfiles(configDir?: string): Promise<AnyProfileConfig[]> {
  const dir = resolveDir(configDir);
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const profiles: AnyProfileConfig[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = await readFile(join(dir, file), 'utf-8');
    profiles.push(JSON.parse(content) as AnyProfileConfig);
  }

  return profiles;
}

export async function deleteProfile(name: string, configDir?: string): Promise<void> {
  const dir = resolveDir(configDir);
  const filePath = join(dir, `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Profile "${name}" not found`);
  }
  await rm(filePath);
}

export async function profileExists(name: string, configDir?: string): Promise<boolean> {
  const dir = resolveDir(configDir);
  return existsSync(join(dir, `${name}.json`));
}
