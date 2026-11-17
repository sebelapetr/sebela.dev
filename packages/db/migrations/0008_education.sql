CREATE TYPE "profile"."education_kind" AS ENUM('school', 'course', 'certification', 'milestone');--> statement-breakpoint
CREATE TABLE "profile"."education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "profile"."education_kind" NOT NULL,
	"title" text NOT NULL,
	"institution" text,
	"started_on" date,
	"ended_on" date,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_slug_unique" UNIQUE("slug"),
	CONSTRAINT "education_position_not_negative" CHECK ("profile"."education"."position" >= 0),
	CONSTRAINT "education_period_is_dated" CHECK ("profile"."education"."started_on" IS NOT NULL OR "profile"."education"."ended_on" IS NOT NULL),
	CONSTRAINT "education_period_is_ordered" CHECK ("profile"."education"."started_on" IS NULL OR "profile"."education"."ended_on" IS NULL OR "profile"."education"."ended_on" >= "profile"."education"."started_on")
);
