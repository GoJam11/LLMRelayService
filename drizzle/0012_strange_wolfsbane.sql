CREATE TABLE "zdr_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"enabled" integer NOT NULL,
	"actor_ip" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zdr_privileged_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint
);
--> statement-breakpoint
ALTER TABLE "console_providers" ADD COLUMN "zdr_capable" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "console_providers" ADD COLUMN "no_training_capable" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "console_providers" ADD COLUMN "zdr_override" integer;--> statement-breakpoint
ALTER TABLE "console_requests" ADD COLUMN "zdr_active" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD COLUMN "zdr_override" integer;--> statement-breakpoint
CREATE INDEX "idx_zdr_audit_log_created_at" ON "zdr_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_zdr_privileged_tokens_token_hash" ON "zdr_privileged_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_zdr_privileged_tokens_expires_at" ON "zdr_privileged_tokens" USING btree ("expires_at");