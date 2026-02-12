import { deleteProfile, listProfiles } from '../config/profiles.js';
import type { AnyProfileConfig } from '../providers/types.js';
import * as logger from '../ui/logger.js';
import { printTable } from '../ui/table.js';

function formatConnection(profile: AnyProfileConfig): string {
  if (profile.provider === 'sqlite') {
    return profile.path;
  }
  return `${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
}

export async function profilesCommand(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    logger.info('No profiles configured. Run: db-restore setup <name>');
    return;
  }

  printTable({
    head: ['Profile', 'Provider', 'Connection'],
    rows: profiles.map((p) => [p.name, p.provider, formatConnection(p)]),
  });
}

export async function removeCommand(name: string): Promise<void> {
  try {
    await deleteProfile(name);
    logger.success(`Profile "${name}" removed.`);
  } catch (err) {
    logger.error(
      err instanceof Error ? err.message : String(err),
      'Run: db-restore profiles to see available profiles'
    );
  }
}
