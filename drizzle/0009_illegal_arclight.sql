CREATE TABLE IF NOT EXISTS "console_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_value" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "console_providers" (
	"channel_name" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"target_base_url" text NOT NULL,
	"system_prompt" text,
	"enable_cc_masquerade" integer DEFAULT 0 NOT NULL,
	"models_json" text DEFAULT '[]' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"auth_header" text,
	"auth_value" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE IF EXISTS "console_requests" ADD COLUMN IF NOT EXISTS "api_key_id" text;
--> statement-breakpoint
ALTER TABLE IF EXISTS "console_requests" ADD COLUMN IF NOT EXISTS "api_key_name" text;
--> statement-breakpoint
ALTER TABLE IF EXISTS "console_requests" ADD COLUMN IF NOT EXISTS "response_payload_truncation_reason" text;
--> statement-breakpoint
ALTER TABLE IF EXISTS "console_requests" ADD COLUMN IF NOT EXISTS "source_request_type" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_api_keys_key_hash" ON "console_api_keys" USING btree ("key_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_api_keys_created_at" ON "console_api_keys" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_providers_created_at" ON "console_providers" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_providers_updated_at" ON "console_providers" USING btree ("updated_at");