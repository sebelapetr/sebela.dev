CREATE SCHEMA "ai_roadmap";
--> statement-breakpoint
CREATE TYPE "ai_roadmap"."resource_status" AS ENUM('planned', 'in-progress', 'completed', 'paused', 'skipped');--> statement-breakpoint
CREATE TYPE "ai_roadmap"."resource_type" AS ENUM('youtube-video', 'youtube-playlist', 'google-drive', 'video', 'link', 'text', 'project', 'book');--> statement-breakpoint
CREATE TABLE "ai_roadmap"."areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"weight" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "areas_slug_unique" UNIQUE("slug"),
	CONSTRAINT "areas_position_not_negative" CHECK ("ai_roadmap"."areas"."position" >= 0),
	CONSTRAINT "areas_weight_in_range" CHECK ("ai_roadmap"."areas"."weight" BETWEEN 1 AND 100),
	CONSTRAINT "areas_slug_not_reserved" CHECK ("ai_roadmap"."areas"."slug" NOT IN ('diary', 'bookshelf', 'events', 'how-to-read-effectively'))
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"area_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modules_slug_unique" UNIQUE("slug"),
	CONSTRAINT "modules_position_not_negative" CHECK ("ai_roadmap"."modules"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."resource_topics" (
	"resource_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "resource_topics_resource_id_topic_id_pk" PRIMARY KEY("resource_id","topic_id"),
	CONSTRAINT "resource_topics_position_unique" UNIQUE("resource_id","position")
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"module_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "ai_roadmap"."resource_type" NOT NULL,
	"status" "ai_roadmap"."resource_status" NOT NULL,
	"estimated_minutes" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"link" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_slug_unique" UNIQUE("slug"),
	CONSTRAINT "resources_position_not_negative" CHECK ("ai_roadmap"."resources"."position" >= 0),
	CONSTRAINT "resources_estimate_not_negative" CHECK ("ai_roadmap"."resources"."estimated_minutes" IS NULL OR "ai_roadmap"."resources"."estimated_minutes" >= 0),
	CONSTRAINT "resources_period_is_ordered" CHECK ("ai_roadmap"."resources"."started_at" IS NULL OR "ai_roadmap"."resources"."finished_at" IS NULL OR "ai_roadmap"."resources"."finished_at" >= "ai_roadmap"."resources"."started_at")
);
--> statement-breakpoint
ALTER TABLE "ai_roadmap"."modules" ADD CONSTRAINT "modules_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "ai_roadmap"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resource_topics" ADD CONSTRAINT "resource_topics_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "ai_roadmap"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resource_topics" ADD CONSTRAINT "resource_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "profile"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resources" ADD CONSTRAINT "resources_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "ai_roadmap"."modules"("id") ON DELETE no action ON UPDATE no action;