import { homedir } from 'node:os';
import { join } from 'node:path';

export const EXCLUDED_TABLES = new Set([
  '_prisma_migrations',
  '__drizzle_migrations',
  'knex_migrations',
  'knex_migrations_lock',
  'typeorm_migrations',
  'SequelizeMeta',
  'SequelizeData',
  'mikro_orm_migrations',
  'objection_migrations',
  '_cf_KV',
]);

export const CONFIG_BASE_DIR = join(homedir(), '.config', 'db-restore');
export const DUMPS_DIR = join(CONFIG_BASE_DIR, 'dumps');

export function getDefaultDumpDir(profileName: string): string {
  return join(DUMPS_DIR, profileName);
}
export const METADATA_FILENAME = '_metadata.json';
export const DUMP_FORMAT_VERSION = 1;

export const PROVIDER_DEFAULTS: Record<
  'postgres' | 'mysql',
  { host: string; port: number; user: string }
> = {
  postgres: { host: 'localhost', port: 5432, user: 'postgres' },
  mysql: { host: 'localhost', port: 3306, user: 'root' },
};

export const BATCH_SIZE = 500;
