-- Add extra_fields_json for provider-specific configuration
ALTER TABLE "console_providers" ADD COLUMN "extra_fields_json" text NOT NULL DEFAULT '';
