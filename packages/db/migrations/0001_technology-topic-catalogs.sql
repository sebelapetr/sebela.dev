CREATE TYPE "profile"."technology_group" AS ENUM('core', 'ai_engineering_focus');--> statement-breakpoint
CREATE TYPE "profile"."technology_tier" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TABLE "profile"."technologies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tier" "profile"."technology_tier" NOT NULL,
	"group" "profile"."technology_group",
	"logo_key" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technologies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "technologies_group_matches_tier" CHECK (("profile"."technologies"."tier" = 'primary') = ("profile"."technologies"."group" IS NOT NULL)),
	CONSTRAINT "technologies_position_not_negative" CHECK ("profile"."technologies"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "profile"."topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug"),
	CONSTRAINT "topics_position_not_negative" CHECK ("profile"."topics"."position" >= 0)
);
