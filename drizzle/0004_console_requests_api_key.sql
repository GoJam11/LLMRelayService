ALTER TABLE "console_requests"
ADD COLUMN IF NOT EXISTS "api_key_id" text;
--> statement-breakpoint
ALTER TABLE "console_requests"
ADD COLUMN IF NOT EXISTS "api_key_name" text;
