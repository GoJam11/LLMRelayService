import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import { migrate as migrateSqlite } from 'drizzle-orm/bun-sqlite/migrator';
import postgres from 'postgres';
import { getDatabaseUrl, getDbDialect } from './config';
import { ensureDialectMarker } from './dialect-guard';
import { getSqliteDatabase } from './client';
import { TEST_DATABASE_URL } from './test-database';

export type MigrationStatus =
  | { state: 'success' }
  | { state: 'skipped'; reason: string }
  | { state: 'failed'; error: string };

const MIGRATION_LOCK_NAMESPACE = 20817;
const MIGRATION_LOCK_KEY = 1;
const migrationPromises = new Map<string, Promise<MigrationStatus>>();

const DB_READY_MAX_RETRIES = 30;
const DB_READY_INITIAL_DELAY_MS = 500;
const DB_READY_MAX_DELAY_MS = 5000;

const PG_MIGRATIONS_FOLDER = './drizzle';
const SQLITE_MIGRATIONS_FOLDER = './drizzle-sqlite';

function isTestDatabase(databaseUrl: string): boolean {
  return databaseUrl === TEST_DATABASE_URL;
}

function isRetryableDbError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const code = (err as any).code;
  // 57P03 = "the database system is starting up"
  if (code === '57P03') return true;
  // Connection refused / reset / terminated — PG not accepting connections yet
  const msg = String((err as any).message ?? '');
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('connection terminated') ||
    msg.includes('the database system is starting up') ||
    msg.includes('the database system is shutting down')
  ) {
    return true;
  }
  return false;
}

async function waitForDbReady(databaseUrl: string): Promise<void> {
  const maxRetries = isTestDatabase(databaseUrl) ? 2 : DB_READY_MAX_RETRIES;
  let delay = DB_READY_INITIAL_DELAY_MS;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const probe = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5 });
    try {
      await probe`SELECT 1`;
      await probe.end();
      return;
    } catch (err) {
      await probe.end({ timeout: 0 }).catch(() => {});
      if (!isRetryableDbError(err) || attempt === maxRetries) {
        throw err;
      }
      console.warn(
        `[DB] Database not ready (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`,
        (err as any).code ?? (err as any).message,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, DB_READY_MAX_DELAY_MS);
    }
  }
}

function runSqliteMigrations(): MigrationStatus {
  try {
    console.info('[DB] Running migrations (sqlite)...');
    migrateSqlite(drizzleSqlite(getSqliteDatabase()), { migrationsFolder: SQLITE_MIGRATIONS_FOLDER });
    console.info('[DB] Migrations complete.');
    return { state: 'success' };
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err);
    console.error('[DB] Migration failed:', errorMessage);
    return { state: 'failed', error: errorMessage };
  }
}

async function runPgMigrations(databaseUrl: string): Promise<MigrationStatus> {
  // Wait for PostgreSQL to be accepting connections
  await waitForDbReady(databaseUrl);

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  try {
    await db.execute(drizzleSql`SELECT pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`);
    console.info('[DB] Running migrations...');
    await migrate(db, { migrationsFolder: PG_MIGRATIONS_FOLDER });
    console.info('[DB] Migrations complete.');
    return { state: 'success' };
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err);
    console.error('[DB] Migration failed:', errorMessage);
    return { state: 'failed', error: errorMessage };
  } finally {
    try {
      await db.execute(drizzleSql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`);
    } finally {
      await sql.end();
    }
  }
}

export async function runMigrations(databaseUrl = getDatabaseUrl(), force = false): Promise<MigrationStatus> {
  if (!force) {
    const existingPromise = migrationPromises.get(databaseUrl);
    if (existingPromise) return existingPromise;
  }

  const migrationPromise = (async (): Promise<MigrationStatus> => {
    if (isTestDatabase(databaseUrl)) {
      return { state: 'skipped', reason: 'Test database detected' };
    }

    // 方言选定后不可切换：数据目录标记与当前 DATABASE_URL 方言不一致时拒绝启动迁移
    try {
      ensureDialectMarker();
    } catch (err: any) {
      const errorMessage = err?.message ?? String(err);
      console.error('[DB] Dialect check failed:', errorMessage);
      return { state: 'failed', error: errorMessage };
    }

    if (getDbDialect() === 'sqlite') {
      return runSqliteMigrations();
    }

    return runPgMigrations(databaseUrl);
  })();

  migrationPromises.set(databaseUrl, migrationPromise);
  migrationPromise.catch(() => {
    if (migrationPromises.get(databaseUrl) === migrationPromise) {
      migrationPromises.delete(databaseUrl);
    }
  });

  return migrationPromise;
}
