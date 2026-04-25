CREATE TABLE IF NOT EXISTS "console_providers" (
	"prefix" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"target_base_url" text NOT NULL,
	"path_rewrite_from" text,
	"path_rewrite_to" text,
	"system_file" text,
	"supported_client_types_json" text DEFAULT '[]' NOT NULL,
	"fallbacks_json" text DEFAULT '[]' NOT NULL,
	"models_json" text DEFAULT '[]' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"auth_header" text,
	"auth_value" text,
	"auth_prefix" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_providers_created_at" ON "console_providers" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_providers_updated_at" ON "console_providers" USING btree ("updated_at");
