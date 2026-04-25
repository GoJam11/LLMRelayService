-- Add 'estimated' flag to track when token usage was estimated vs. actual
ALTER TABLE "console_requests" ADD COLUMN "token_usage_estimated" integer DEFAULT 0;

CREATE INDEX "idx_console_requests_token_estimated" ON "console_requests"("token_usage_estimated");
