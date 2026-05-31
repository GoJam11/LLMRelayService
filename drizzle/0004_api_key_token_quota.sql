ALTER TABLE "console_api_keys" ADD COLUMN "token_quota" bigint;--> statement-breakpoint
ALTER TABLE "console_api_keys" ADD COLUMN "token_used" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "console_requests" ADD COLUMN "quota_charged_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "console_requests"
SET "quota_charged_tokens" = GREATEST(0, "total_tokens")::bigint;--> statement-breakpoint
UPDATE "console_api_keys" AS keys
SET "token_used" = usage.total_tokens
FROM (
  SELECT "api_key_id", COALESCE(SUM(GREATEST(0, "total_tokens")), 0)::bigint AS total_tokens
  FROM "console_requests"
  WHERE "api_key_id" IS NOT NULL
  GROUP BY "api_key_id"
) AS usage
WHERE keys."id" = usage."api_key_id";
