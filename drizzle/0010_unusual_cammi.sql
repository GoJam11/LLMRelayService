ALTER TABLE "console_providers" ADD COLUMN "auto_sync_models" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "console_providers" ADD COLUMN "models_synced_at" bigint;