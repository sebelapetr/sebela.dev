CREATE SCHEMA "profile";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "profile"."persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"headline" text NOT NULL,
	"short_bio" text NOT NULL,
	"long_bio" text,
	"location" text,
	"email" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" text,
	"career_started_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "persons_singleton_is_true" CHECK ("profile"."persons"."singleton")
);
--> statement-breakpoint
CREATE TABLE "auth"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"public_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_public_id_unique" UNIQUE("public_id")
);
