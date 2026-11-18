CREATE TABLE "ai_roadmap"."diary_entries" (
	"date" date PRIMARY KEY NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_date" date NOT NULL,
	"resource_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_period_is_ordered" CHECK ("ai_roadmap"."time_entries"."ended_at" > "ai_roadmap"."time_entries"."started_at"),
	CONSTRAINT "time_entries_within_diary_day" CHECK ("ai_roadmap"."time_entries"."diary_date" = ("ai_roadmap"."time_entries"."started_at" AT TIME ZONE 'Europe/Prague')::date AND "ai_roadmap"."time_entries"."ended_at" <= (("ai_roadmap"."time_entries"."diary_date" + 1)::timestamp AT TIME ZONE 'Europe/Prague'))
);
--> statement-breakpoint
ALTER TABLE "ai_roadmap"."time_entries" ADD CONSTRAINT "time_entries_diary_date_diary_entries_date_fk" FOREIGN KEY ("diary_date") REFERENCES "ai_roadmap"."diary_entries"("date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."time_entries" ADD CONSTRAINT "time_entries_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "ai_roadmap"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_diary_date_index" ON "ai_roadmap"."time_entries" USING btree ("diary_date");--> statement-breakpoint
CREATE INDEX "time_entries_resource_id_index" ON "ai_roadmap"."time_entries" USING btree ("resource_id");--> statement-breakpoint
-- Added by hand: drizzle-kit cannot express an exclusion constraint. It refuses every pair of
-- overlapping half-open intervals, whatever their learning target, also between concurrent writes.
ALTER TABLE "ai_roadmap"."time_entries" ADD CONSTRAINT "time_entries_do_not_overlap" EXCLUDE USING gist (tstzrange("started_at", "ended_at", '[)') WITH &&);
