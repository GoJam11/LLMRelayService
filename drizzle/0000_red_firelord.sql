CREATE TABLE "console_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_value" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked" integer DEFAULT 0 NOT NULL,
	"allowed_models_json" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_providers" (
	"channel_name" text PRIMARY KEY NOT NULL,
	"provider_uuid" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"target_base_url" text NOT NULL,
	"system_prompt" text,
	"models_json" text DEFAULT '[]' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"auth_header" text,
	"auth_value" text,
	"extra_fields_json" text DEFAULT '' NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_request_cache_points" (
	"request_id" text NOT NULL,
	"point_index" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"route_prefix" text NOT NULL,
	"upstream_type" text DEFAULT 'anthropic' NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"target_url" text NOT NULL,
	"request_model" text NOT NULL,
	"metadata_user_id" text DEFAULT '' NOT NULL,
	"anthropic_beta" text DEFAULT '' NOT NULL,
	"anthropic_version" text DEFAULT '' NOT NULL,
	"cache_key" text NOT NULL,
	"point_location" text NOT NULL,
	"point_type" text NOT NULL,
	"point_head" text NOT NULL,
	"point_hash" text NOT NULL,
	"prefix_hash" text NOT NULL,
	"prefix_length" integer DEFAULT 0 NOT NULL,
	"cache_created" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "console_request_cache_points_pk" PRIMARY KEY("request_id","point_index")
);
--> statement-breakpoint
CREATE TABLE "console_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"route_prefix" text NOT NULL,
	"upstream_type" text DEFAULT 'anthropic' NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"target_url" text NOT NULL,
	"request_model" text NOT NULL,
	"api_key_id" text,
	"api_key_name" text,
	"original_payload" text,
	"original_payload_truncated" integer DEFAULT 0 NOT NULL,
	"original_summary_json" text,
	"forwarded_payload" text,
	"forwarded_payload_truncated" integer DEFAULT 0 NOT NULL,
	"forwarded_summary_json" text,
	"original_headers_json" text,
	"forward_headers_json" text,
	"response_headers_json" text,
	"response_status" integer,
	"response_status_text" text,
	"response_payload" text,
	"response_payload_truncated" integer DEFAULT 0 NOT NULL,
	"response_payload_truncation_reason" text,
	"response_body_bytes" integer DEFAULT 0 NOT NULL,
	"first_chunk_at" bigint,
	"first_token_at" bigint,
	"completed_at" bigint,
	"has_streaming_content" integer DEFAULT 0 NOT NULL,
	"response_model" text,
	"stop_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_output_tokens" integer DEFAULT 0 NOT NULL,
	"ephemeral_5m_input_tokens" integer DEFAULT 0 NOT NULL,
	"ephemeral_1h_input_tokens" integer DEFAULT 0 NOT NULL,
	"failover_from" text,
	"failover_chain_json" text,
	"original_route_prefix" text,
	"original_request_model" text,
	"failover_reason" text,
	"source_request_type" text DEFAULT 'unknown' NOT NULL,
	"token_usage_estimated" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"description" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "model_aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "model_catalog_cache" (
	"model_id" text PRIMARY KEY NOT NULL,
	"context_window" integer,
	"pricing_json" text,
	"fetched_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "console_request_cache_points" ADD CONSTRAINT "console_request_cache_points_request_id_console_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."console_requests"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_console_api_keys_key_hash" ON "console_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_console_api_keys_created_at" ON "console_api_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_console_providers_created_at" ON "console_providers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_console_providers_updated_at" ON "console_providers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_debug_cache_points_request_id" ON "console_request_cache_points" USING btree ("request_id","point_index");--> statement-breakpoint
CREATE INDEX "idx_debug_cache_points_cache_key" ON "console_request_cache_points" USING btree ("cache_key","created_at");--> statement-breakpoint
CREATE INDEX "idx_debug_cache_points_created" ON "console_request_cache_points" USING btree ("cache_created","created_at");--> statement-breakpoint
CREATE INDEX "idx_console_requests_created_at" ON "console_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_console_requests_compare" ON "console_requests" USING btree ("route_prefix","method","path","request_model","created_at");--> statement-breakpoint
CREATE INDEX "idx_console_requests_route_prefix" ON "console_requests" USING btree ("route_prefix","created_at");--> statement-breakpoint
CREATE INDEX "idx_console_requests_response_model" ON "console_requests" USING btree ("response_model","created_at");--> statement-breakpoint
CREATE INDEX "idx_model_aliases_alias" ON "model_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "idx_model_aliases_created_at" ON "model_aliases" USING btree ("created_at");