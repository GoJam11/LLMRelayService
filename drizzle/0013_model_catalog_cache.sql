CREATE TABLE "model_catalog_cache" (
	"model_id" text PRIMARY KEY NOT NULL,
	"context_window" integer,
	"pricing_json" text,
	"fetched_at" bigint NOT NULL
);
