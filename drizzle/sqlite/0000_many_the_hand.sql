CREATE TABLE `console_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_value` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked` integer DEFAULT 0 NOT NULL,
	`allowed_models_json` text DEFAULT '[]' NOT NULL,
	`cost_quota_microusd` integer,
	`cost_used_microusd` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_console_api_keys_key_hash` ON `console_api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_console_api_keys_created_at` ON `console_api_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `console_providers` (
	`channel_name` text PRIMARY KEY NOT NULL,
	`provider_uuid` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`target_base_url` text NOT NULL,
	`system_prompt` text,
	`models_json` text DEFAULT '[]' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`auth_header` text,
	`auth_value` text,
	`extra_fields_json` text DEFAULT '' NOT NULL,
	`routing_visibility` text DEFAULT 'direct' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`auto_sync_models` integer DEFAULT 0 NOT NULL,
	`models_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_console_providers_created_at` ON `console_providers` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_console_providers_updated_at` ON `console_providers` (`updated_at`);--> statement-breakpoint
CREATE TABLE `console_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`route_prefix` text NOT NULL,
	`upstream_type` text DEFAULT 'anthropic' NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`target_url` text NOT NULL,
	`request_model` text NOT NULL,
	`api_key_id` text,
	`api_key_name` text,
	`original_payload` text,
	`original_payload_truncated` integer DEFAULT 0 NOT NULL,
	`original_summary_json` text,
	`forwarded_payload` text,
	`forwarded_payload_truncated` integer DEFAULT 0 NOT NULL,
	`forwarded_summary_json` text,
	`original_headers_json` text,
	`forward_headers_json` text,
	`response_headers_json` text,
	`response_status` integer,
	`response_status_text` text,
	`response_payload` text,
	`response_payload_truncated` integer DEFAULT 0 NOT NULL,
	`response_payload_truncation_reason` text,
	`response_body_bytes` integer DEFAULT 0 NOT NULL,
	`first_chunk_at` integer,
	`first_token_at` integer,
	`completed_at` integer,
	`has_streaming_content` integer DEFAULT 0 NOT NULL,
	`response_model` text,
	`stop_reason` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_input_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_output_tokens` integer DEFAULT 0 NOT NULL,
	`ephemeral_5m_input_tokens` integer DEFAULT 0 NOT NULL,
	`ephemeral_1h_input_tokens` integer DEFAULT 0 NOT NULL,
	`quota_charged_microusd` integer DEFAULT 0 NOT NULL,
	`cost_pricing_json` text,
	`failover_from` text,
	`failover_chain_json` text,
	`original_route_prefix` text,
	`original_request_model` text,
	`failover_reason` text,
	`retry_attempt` integer DEFAULT 0 NOT NULL,
	`source_request_type` text DEFAULT 'unknown' NOT NULL,
	`token_usage_estimated` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_console_requests_created_at` ON `console_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_console_requests_compare` ON `console_requests` (`route_prefix`,`method`,`path`,`request_model`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_console_requests_route_prefix` ON `console_requests` (`route_prefix`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_console_requests_response_model` ON `console_requests` (`response_model`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_console_requests_api_key_id` ON `console_requests` (`api_key_id`);--> statement-breakpoint
CREATE TABLE `gateway_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alias` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`targets_json` text DEFAULT '' NOT NULL,
	`description` text,
	`visible` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`return_real_model` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_aliases_alias_unique` ON `model_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `idx_model_aliases_alias` ON `model_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `idx_model_aliases_created_at` ON `model_aliases` (`created_at`);--> statement-breakpoint
CREATE TABLE `model_catalog_cache` (
	`model_id` text PRIMARY KEY NOT NULL,
	`context_window` integer,
	`pricing_json` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_metadata_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_name` text NOT NULL,
	`model_id` text NOT NULL,
	`context_window` integer,
	`pricing_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_model_metadata_overrides_channel_model` ON `model_metadata_overrides` (`channel_name`,`model_id`);--> statement-breakpoint
CREATE INDEX `idx_model_metadata_overrides_updated_at` ON `model_metadata_overrides` (`updated_at`);