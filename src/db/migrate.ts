import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import { getDatabaseUrl } from './config';
import { TEST_DATABASE_URL } from './test-database';

// Inline migrations keep deployed databases compatible with the running code at startup.
async function runInlineMigrations(db: ReturnType<typeof drizzle>) {
  // ── Bootstrap: create base tables in their current final form ──
  // For fresh databases, these CREATE statements initialize the schema
  // so the app can start without running drizzle-kit migrate separately.
  // All future schema changes should be added as inline ALTER statements below.

  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "console_requests" (
      "request_id" text PRIMARY KEY NOT NULL,
      "created_at" bigint NOT NULL,
      "route_prefix" text NOT NULL,
      "upstream_type" text DEFAULT 'anthropic' NOT NULL,
      "method" text NOT NULL,
      "path" text NOT NULL,
      "target_url" text NOT NULL,
      "request_model" text NOT NULL,
      "api_key_id" text,
      "api_key_name" text,
      "original_payload" text,
      "original_payload_truncated" integer DEFAULT 0 NOT NULL,
      "original_summary_json" text,
      "forwarded_payload" text,
      "forwarded_payload_truncated" integer DEFAULT 0 NOT NULL,
      "forwarded_summary_json" text,
      "original_headers_json" text,
      "forward_headers_json" text,
      "response_headers_json" text,
      "response_status" integer,
      "response_status_text" text,
      "response_payload" text,
      "response_payload_truncated" integer DEFAULT 0 NOT NULL,
      "response_payload_truncation_reason" text,
      "response_body_bytes" integer DEFAULT 0 NOT NULL,
      "first_chunk_at" bigint,
      "first_token_at" bigint,
      "completed_at" bigint,
      "has_streaming_content" integer DEFAULT 0 NOT NULL,
      "response_model" text,
      "stop_reason" text,
      "input_tokens" integer DEFAULT 0 NOT NULL,
      "output_tokens" integer DEFAULT 0 NOT NULL,
      "total_tokens" integer DEFAULT 0 NOT NULL,
      "cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
      "cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
      "cached_input_tokens" integer DEFAULT 0 NOT NULL,
      "reasoning_output_tokens" integer DEFAULT 0 NOT NULL,
      "ephemeral_5m_input_tokens" integer DEFAULT 0 NOT NULL,
      "ephemeral_1h_input_tokens" integer DEFAULT 0 NOT NULL,
      "failover_from" text,
      "failover_chain_json" text,
      "original_route_prefix" text,
      "original_request_model" text,
      "failover_reason" text,
      "source_request_type" text NOT NULL DEFAULT 'unknown',
      "token_usage_estimated" integer NOT NULL DEFAULT 0
    )
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_requests_created_at" ON "console_requests" USING btree ("created_at")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_requests_compare" ON "console_requests" USING btree ("route_prefix", "method", "path", "request_model", "created_at")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_requests_route_prefix" ON "console_requests" USING btree ("route_prefix", "created_at")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_requests_response_model" ON "console_requests" USING btree ("response_model", "created_at")
  `);

  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "console_request_cache_points" (
      "request_id" text NOT NULL,
      "point_index" integer NOT NULL,
      "created_at" bigint NOT NULL,
      "route_prefix" text NOT NULL,
      "upstream_type" text DEFAULT 'anthropic' NOT NULL,
      "method" text NOT NULL,
      "path" text NOT NULL,
      "target_url" text NOT NULL,
      "request_model" text NOT NULL,
      "metadata_user_id" text DEFAULT '' NOT NULL,
      "anthropic_beta" text DEFAULT '' NOT NULL,
      "anthropic_version" text DEFAULT '' NOT NULL,
      "cache_key" text NOT NULL,
      "point_location" text NOT NULL,
      "point_type" text NOT NULL,
      "point_head" text NOT NULL,
      "point_hash" text NOT NULL,
      "prefix_hash" text NOT NULL,
      "prefix_length" integer DEFAULT 0 NOT NULL,
      "cache_created" integer DEFAULT 0 NOT NULL,
      CONSTRAINT "console_request_cache_points_pk" PRIMARY KEY("request_id","point_index"),
      CONSTRAINT "console_request_cache_points_request_id_console_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."console_requests"("request_id") ON DELETE cascade ON UPDATE no action
    )
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_debug_cache_points_request_id" ON "console_request_cache_points" USING btree ("request_id", "point_index")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_debug_cache_points_cache_key" ON "console_request_cache_points" USING btree ("cache_key", "created_at")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_debug_cache_points_created" ON "console_request_cache_points" USING btree ("cache_created", "created_at")
  `);

  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "console_api_keys" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "key_hash" text NOT NULL,
      "key_value" text NOT NULL,
      "prefix" text NOT NULL,
      "created_at" bigint NOT NULL,
      "last_used_at" bigint,
      "revoked" integer DEFAULT 0 NOT NULL,
      "allowed_models_json" text NOT NULL DEFAULT '[]'
    )
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_api_keys_key_hash" ON "console_api_keys" USING btree ("key_hash")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_api_keys_created_at" ON "console_api_keys" USING btree ("created_at")
  `);

  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "console_providers" (
      "channel_name" text PRIMARY KEY NOT NULL,
      "provider_uuid" text NOT NULL DEFAULT '',
      "type" text NOT NULL,
      "target_base_url" text NOT NULL,
      "system_prompt" text,
      "models_json" text DEFAULT '[]' NOT NULL,
      "priority" integer DEFAULT 0 NOT NULL,
      "auth_header" text,
      "auth_value" text,
      "extra_fields_json" text NOT NULL DEFAULT '',
      "enabled" integer NOT NULL DEFAULT 1,
      "created_at" bigint NOT NULL,
      "updated_at" bigint NOT NULL
    )
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_providers_created_at" ON "console_providers" USING btree ("created_at")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_console_providers_updated_at" ON "console_providers" USING btree ("updated_at")
  `);

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
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_model_aliases_alias" ON "model_aliases" USING btree ("alias")
  `);
  await db.execute(drizzleSql`
    CREATE INDEX IF NOT EXISTS "idx_model_aliases_created_at" ON "model_aliases" USING btree ("created_at")
  `);

  await db.execute(drizzleSql`
    CREATE TABLE IF NOT EXISTS "model_catalog_cache" (
      "model_id" text PRIMARY KEY NOT NULL,
      "context_window" integer,
      "pricing_json" text,
      "fetched_at" bigint NOT NULL
    )
  `);

  // ── Incremental inline migrations (0011+) ──
  // These are idempotent and safe to re-run on every startup.

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
