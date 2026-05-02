-- Add allowed_models_json to restrict models per API key
ALTER TABLE "console_api_keys" ADD COLUMN "allowed_models_json" text NOT NULL DEFAULT '[]';
