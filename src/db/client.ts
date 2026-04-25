import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';
import { getDatabaseUrl } from './config';

let sharedSqlClient: Sql | null = null;

export function getSqlClient(databaseUrl = getDatabaseUrl()): Sql {
  const defaultDatabaseUrl = getDatabaseUrl();
  if (databaseUrl !== defaultDatabaseUrl) {
    return postgres(databaseUrl, { prepare: false });
  }

  if (!sharedSqlClient) {
    sharedSqlClient = postgres(databaseUrl, { prepare: false });
  }

  return sharedSqlClient;
}

export function createDbClient(databaseUrl = getDatabaseUrl()) {
  return drizzle(getSqlClient(databaseUrl), { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;
