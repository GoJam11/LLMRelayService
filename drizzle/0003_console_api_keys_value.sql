ALTER TABLE "console_api_keys"
ADD COLUMN IF NOT EXISTS "key_value" text;
--> statement-breakpoint
UPDATE "console_api_keys"
SET "key_value" = COALESCE("key_value", '')
WHERE "key_value" IS NULL;
--> statement-breakpoint
ALTER TABLE "console_api_keys"
ALTER COLUMN "key_value" SET NOT NULL;
