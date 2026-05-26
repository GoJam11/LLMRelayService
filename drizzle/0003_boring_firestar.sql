CREATE TABLE "model_metadata_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_name" text NOT NULL,
	"model_id" text NOT NULL,
	"context_window" integer,
	"pricing_json" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_model_metadata_overrides_channel_model" ON "model_metadata_overrides" USING btree ("channel_name","model_id");--> statement-breakpoint
CREATE INDEX "idx_model_metadata_overrides_updated_at" ON "model_metadata_overrides" USING btree ("updated_at");