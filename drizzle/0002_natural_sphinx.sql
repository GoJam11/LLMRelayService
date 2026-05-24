CREATE TABLE "gateway_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" text DEFAULT '{}' NOT NULL,
	"updated_at" bigint NOT NULL
);
