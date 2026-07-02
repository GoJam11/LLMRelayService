import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import postgres, { type Sql } from 'postgres';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';
import * as sqliteSchema from './schema.sqlite';
import { getDatabaseUrl, getDbDialect } from './config';

let sharedSqlClient: Sql | null = null;
let sharedSqliteDatabase: Database | null = null;
let sharedSqliteDrizzle: ReturnType<typeof createSqliteDrizzle> | null = null;

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

// SQLite 模式的共享连接（bun:sqlite 单连接即可，WAL 允许读写并发）
export function getSqliteDatabase(filePath = getDatabaseUrl()): Database {
  if (!sharedSqliteDatabase) {
    mkdirSync(dirname(filePath), { recursive: true });
    const database = new Database(filePath, { create: true });
    database.run('PRAGMA journal_mode = WAL');
    database.run('PRAGMA busy_timeout = 5000');
    database.run('PRAGMA synchronous = NORMAL');
    database.run('PRAGMA foreign_keys = ON');
    sharedSqliteDatabase = database;
  }
  return sharedSqliteDatabase;
}

function createSqliteDrizzle() {
  return drizzleSqlite(getSqliteDatabase(), { schema: sqliteSchema });
}

function createPgDbClient(databaseUrl: string) {
  return drizzlePg(getSqlClient(databaseUrl), { schema });
}

// 统一按 PG 客户端类型对外暴露；SQLite 模式下运行时是 bun-sqlite 客户端，配合
// schema.ts 的方言选择，两者生成的 SQL 与取值语义一致（见 schema.ts 顶部说明）。
// 注意：db.execute() 是 PG 专属 API，SQLite 分支需改用 getSqliteDatabase() 原生执行。
export function createDbClient(databaseUrl = getDatabaseUrl()): ReturnType<typeof createPgDbClient> {
  if (getDbDialect() === 'sqlite') {
    if (!sharedSqliteDrizzle) {
      sharedSqliteDrizzle = createSqliteDrizzle();
    }
    return sharedSqliteDrizzle as unknown as ReturnType<typeof createPgDbClient>;
  }
  return createPgDbClient(databaseUrl);
}

export type DbClient = ReturnType<typeof createDbClient>;
