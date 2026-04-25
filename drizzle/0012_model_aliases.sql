CREATE TABLE "model_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"description" text,
	"enabled" integer NOT NULL DEFAULT 1,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "model_aliases_alias_unique" UNIQUE("alias")
);
