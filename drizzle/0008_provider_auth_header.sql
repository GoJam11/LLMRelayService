ALTER TABLE "console_providers" ADD COLUMN IF NOT EXISTS "auth_header" text;
--> statement-breakpoint
UPDATE "console_providers"
SET "auth_header" = CASE
  WHEN "type" = 'anthropic' THEN 'x-api-key'
  ELSE 'authorization'
END
WHERE "auth_value" IS NOT NULL
  AND ("auth_header" IS NULL OR "auth_header" = '');