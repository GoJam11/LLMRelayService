ALTER TABLE "console_request_cache_points" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "console_request_cache_points" CASCADE;--> statement-breakpoint
CREATE INDEX "idx_console_requests_api_key_id" ON "console_requests" USING btree ("api_key_id");