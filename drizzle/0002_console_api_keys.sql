CREATE TABLE IF NOT EXISTS "console_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_api_keys_key_hash" ON "console_api_keys" USING btree ("key_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_api_keys_created_at" ON "console_api_keys" USING btree ("created_at");
