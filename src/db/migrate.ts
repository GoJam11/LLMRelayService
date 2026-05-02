import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import { getDatabaseUrl } from './config';
import { TEST_DATABASE_URL } from './test-database';

// Inline migrations keep deployed databases compatible with the running code at startup.
async function runInlineMigrations(db: ReturnType<typeof drizzle>) {
  // 0011_provider_enabled: add enabled column
  await db.execute(drizzleSql`
    ALTER TABLE "console_providers"
    ADD COLUMN IF NOT EXISTS "enabled" integer NOT NULL DEFAULT 1
  `);

  // 0012_model_aliases: create model_aliases table
  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "model_aliases" (
      "id" serial PRIMARY KEY,
      "alias" text NOT NULL UNIQUE,
      "provider" text NOT NULL,
      "model" text NOT NULL,
      "description" text,
      "enabled" integer NOT NULL DEFAULT 1,
      "created_at" bigint NOT NULL,
      "updated_at" bigint NOT NULL
    )
  `);

  // 0013_model_catalog_cache: create model_catalog_cache table
  await db.execute(drizzleSql`
    ALTER TABLE console_providers ADD COLUMN IF NOT EXISTS extra_fields_json text NOT NULL DEFAULT '';
  `);
  await db.execute(drizzleSql`
  CREATE TABLE IF NOT EXISTS "model_catalog_cache" (
      "model_id" text PRIMARY KEY NOT NULL,
      "context_window" integer,
      "pricing_json" text,
      "fetched_at" bigint NOT NULL
    )
  `);

  // 0014_provider_uuid: add stable provider_uuid column
  await db.execute(drizzleSql`
    ALTER TABLE console_providers ADD COLUMN IF NOT EXISTS provider_uuid text NOT NULL DEFAULT '';
  `);

  // 0015_api_key_allowed_models: add allowed_models_json to restrict models per key
  await db.execute(drizzleSql`
    ALTER TABLE "console_api_keys"
    ADD COLUMN IF NOT EXISTS "allowed_models_json" text NOT NULL DEFAULT '[]'
  `);

  // 0016_token_estimated: track whether token usage was estimated
  await db.execute(drizzleSql`
    ALTER TABLE "console_requests"
    ADD COLUMN IF NOT EXISTS "token_usage_estimated" integer DEFAULT 0
  `);
  await db.execute(drizzleSql`
    UPDATE "console_requests"
    SET "token_usage_estimated" = 0
    WHERE "token_usage_estimated" IS NULL
  `);
  await db.execute(drizzleSql`
    ALTER TABLE "console_requests"
    ALTER COLUMN "token_usage_estimated" SET DEFAULT 0
  `);
  await db.execute(drizzleSql`
    ALTER TABLE "console_requests"
    ALTER COLUMN "token_usage_estimated" SET NOT NULL
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_requests_token_estimated"
    ON "console_requests"("token_usage_estimated")
  `);
}

const MIGRATION_LOCK_NAMESPACE = 20817;
const MIGRATION_LOCK_KEY = 1;
const migrationPromises = new Map<string, Promise<void>>();

const DB_READY_MAX_RETRIES = 30;
const DB_READY_INITIAL_DELAY_MS = 500;
const DB_READY_MAX_DELAY_MS = 5000;

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

export async function runMigrations(databaseUrl = getDatabaseUrl()) {
  const existingPromise = migrationPromises.get(databaseUrl);
  if (existingPromise) return existingPromise;

  const migrationPromise = (async () => {
    // Wait for PostgreSQL to be accepting connections
    await waitForDbReady(databaseUrl);

    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    const db = drizzle(sql);

    try {
      await db.execute(drizzleSql`SELECT pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`);
      console.info('[DB] Running inline migrations...');
      await runInlineMigrations(db);
      console.info('[DB] Inline migrations complete.');
    } finally {
      try {
        await db.execute(drizzleSql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_KEY})`);
      } finally {
        await sql.end();
      }
    }
  })();

  migrationPromises.set(databaseUrl, migrationPromise);
  migrationPromise.catch(() => {
    if (migrationPromises.get(databaseUrl) === migrationPromise) {
      migrationPromises.delete(databaseUrl);
    }
  });

  return migrationPromise;
}
