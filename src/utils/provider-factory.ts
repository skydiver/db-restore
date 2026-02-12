import type {
  AnyProfileConfig,
  ConnectionConfig,
  DatabaseProvider,
  SqliteConfig,
} from '../providers/types.js';

export async function createProvider(provider: string): Promise<DatabaseProvider> {
  switch (provider) {
    case 'sqlite': {
      const { SqliteProvider } = await import('../providers/sqlite.js');
      return new SqliteProvider();
    }
    case 'postgres': {
      const { PostgresProvider } = await import('../providers/postgres.js');
      return new PostgresProvider();
    }
    case 'mysql': {
      const { MysqlProvider } = await import('../providers/mysql.js');
      return new MysqlProvider();
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export function buildConnectionConfig(
  profile: AnyProfileConfig,
  password?: string
): ConnectionConfig | SqliteConfig {
  if (profile.provider === 'sqlite') {
    return { path: profile.path };
  }
  return {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: password ?? '',
  };
}
