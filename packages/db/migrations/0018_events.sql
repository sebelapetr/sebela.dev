CREATE TYPE "ai_roadmap"."event_kind" AS ENUM('conference', 'meetup', 'workshop', 'lecture');--> statement-breakpoint
CREATE TABLE "ai_roadmap"."event_topics" (
	"event_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "event_topics_event_id_topic_id_pk" PRIMARY KEY("event_id","topic_id"),
	CONSTRAINT "event_topics_position_unique" UNIQUE("event_id","position")
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "ai_roadmap"."event_kind" NOT NULL,
	"organizer" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"place" text,
	"online" boolean DEFAULT false NOT NULL,
	"link" text,
	"takeaways" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_period_is_ordered" CHECK ("ai_roadmap"."events"."ends_on" >= "ai_roadmap"."events"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "ai_roadmap"."time_entries" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."time_entries" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."event_topics" ADD CONSTRAINT "event_topics_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "ai_roadmap"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."event_topics" ADD CONSTRAINT "event_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "profile"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_period_index" ON "ai_roadmap"."events" USING btree ("starts_on","ends_on");--> statement-breakpoint
ALTER TABLE "ai_roadmap"."time_entries" ADD CONSTRAINT "time_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "ai_roadmap"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_event_id_index" ON "ai_roadmap"."time_entries" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "ai_roadmap"."time_entries" ADD CONSTRAINT "time_entries_one_target" CHECK (num_nonnulls("ai_roadmap"."time_entries"."resource_id", "ai_roadmap"."time_entries"."event_id") = 1);