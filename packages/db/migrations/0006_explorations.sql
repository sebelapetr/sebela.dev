CREATE TYPE "profile"."exploration_status" AS ENUM('built', 'tested', 'designed');--> statement-breakpoint
CREATE TABLE "profile"."exploration_technologies" (
	"exploration_id" uuid NOT NULL,
	"technology_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "exploration_technologies_exploration_id_technology_id_pk" PRIMARY KEY("exploration_id","technology_id"),
	CONSTRAINT "exploration_technologies_position_unique" UNIQUE("exploration_id","position")
);
--> statement-breakpoint
CREATE TABLE "profile"."exploration_topics" (
	"exploration_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "exploration_topics_exploration_id_topic_id_pk" PRIMARY KEY("exploration_id","topic_id"),
	CONSTRAINT "exploration_topics_position_unique" UNIQUE("exploration_id","position")
);
--> statement-breakpoint
CREATE TABLE "profile"."explorations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"status" "profile"."exploration_status" NOT NULL,
	"concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explorations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "explorations_position_not_negative" CHECK ("profile"."explorations"."position" >= 0),
	CONSTRAINT "explorations_period_is_ordered" CHECK ("profile"."explorations"."ended_on" IS NULL OR "profile"."explorations"."ended_on" >= "profile"."explorations"."started_on")
);
--> statement-breakpoint
ALTER TABLE "profile"."exploration_technologies" ADD CONSTRAINT "exploration_technologies_exploration_id_explorations_id_fk" FOREIGN KEY ("exploration_id") REFERENCES "profile"."explorations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."exploration_technologies" ADD CONSTRAINT "exploration_technologies_technology_id_technologies_id_fk" FOREIGN KEY ("technology_id") REFERENCES "profile"."technologies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."exploration_topics" ADD CONSTRAINT "exploration_topics_exploration_id_explorations_id_fk" FOREIGN KEY ("exploration_id") REFERENCES "profile"."explorations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."exploration_topics" ADD CONSTRAINT "exploration_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "profile"."topics"("id") ON DELETE no action ON UPDATE no action;