ALTER TABLE "console_requests"
ADD COLUMN IF NOT EXISTS "source_request_type" text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_console_requests_source_request_type" ON "console_requests" ("source_request_type", "created_at");
