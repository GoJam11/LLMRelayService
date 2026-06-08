ALTER TABLE "console_providers" ADD COLUMN "routing_visibility" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "targets_json" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "visible" integer DEFAULT 1 NOT NULL;