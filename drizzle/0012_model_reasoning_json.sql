ALTER TABLE "model_catalog_cache" ADD COLUMN IF NOT EXISTS "reasoning_json" text;
ALTER TABLE "model_metadata_overrides" ADD COLUMN IF NOT EXISTS "reasoning_json" text;
