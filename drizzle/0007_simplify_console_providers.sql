ALTER TABLE "console_providers" RENAME COLUMN "prefix" TO "channel_name";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "path_rewrite_from";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "path_rewrite_to";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "system_file";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "supported_client_types_json";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "fallbacks_json";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "auth_header";
--> statement-breakpoint
ALTER TABLE "console_providers" DROP COLUMN IF EXISTS "auth_prefix";
--> statement-breakpoint
ALTER TABLE "console_providers" ADD COLUMN IF NOT EXISTS "system_prompt" text;
--> statement-breakpoint
ALTER TABLE "console_providers" ADD COLUMN IF NOT EXISTS "enable_cc_masquerade" integer NOT NULL DEFAULT 0;
