import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';
import { getDatabaseUrl, getDbDriver, getSqliteFilePath } from './config';

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

// A single bun:sqlite connection is shared process-wide. SQLite is embedded, so
// unlike PostgreSQL there is no connection pool; concurrent access is serialized
// by the driver (WAL mode + busy_timeout let readers and the single writer
// coexist without spurious SQLITE_BUSY errors).
let sharedSqliteDb: import('bun:sqlite').Database | null = null;

function getSqliteDatabase(filePath: string): import('bun:sqlite').Database {
  if (!sharedSqliteDb) {
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    if (filePath !== ':memory:') {
      // Ensure the parent directory exists (e.g. a mounted /data volume).
      mkdirSync(dirname(filePath), { recursive: true });
    }
    sharedSqliteDb = new Database(filePath, { create: true });
    sharedSqliteDb.exec('PRAGMA journal_mode = WAL;');
    sharedSqliteDb.exec('PRAGMA busy_timeout = 5000;');
    sharedSqliteDb.exec('PRAGMA foreign_keys = ON;');
  }
  return sharedSqliteDb;
}

// The stores are typed against the PostgreSQL client surface. The subset of the
// query builder they use (select / insert / update / delete / onConflictDoUpdate
// / returning) is shared across dialects, so we cast the SQLite client to the
// same type. Dialect-specific raw SQL is branched explicitly at the call sites.
export type DbClient = PostgresJsDatabase<typeof schema>;

function createSqliteClient(databaseUrl = getDatabaseUrl()): DbClient {
  const { drizzle: drizzleSqlite } = require('drizzle-orm/bun-sqlite') as typeof import('drizzle-orm/bun-sqlite');
  const sqliteDb = getSqliteDatabase(getSqliteFilePath(databaseUrl));
  return drizzleSqlite(sqliteDb, { schema }) as unknown as DbClient;
}

export function createDbClient(databaseUrl = getDatabaseUrl()): DbClient {
  if (getDbDriver() === 'sqlite') {
    return createSqliteClient(databaseUrl);
  }
  return drizzle(getSqlClient(databaseUrl), { schema });
}
