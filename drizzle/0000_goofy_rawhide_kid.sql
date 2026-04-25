CREATE TABLE "debug_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"upstream_type" text NOT NULL,
	"route_prefix" text NOT NULL,
	"target_url" text NOT NULL,
	"status_code" integer,
	"error_message" text,
	"payload_summary" jsonb,
	"forward_headers" jsonb,
	"response_usage" jsonb,
	"response_timing" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "debug_requests_request_id_unique" ON "debug_requests" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_timestamp" ON "debug_requests" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_upstream_type" ON "debug_requests" USING btree ("upstream_type");