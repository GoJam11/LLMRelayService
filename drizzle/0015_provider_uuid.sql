-- Add stable provider_uuid column for provider identification
ALTER TABLE "console_providers" ADD COLUMN "provider_uuid" text NOT NULL DEFAULT '';
