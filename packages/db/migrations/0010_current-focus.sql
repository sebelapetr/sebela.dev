CREATE TABLE "profile"."current_focus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"link" text,
	"project_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "current_focus_slug_unique" UNIQUE("slug"),
	CONSTRAINT "current_focus_position_not_negative" CHECK ("profile"."current_focus"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "profile"."current_focus_topics" (
	"current_focus_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "current_focus_topics_current_focus_id_topic_id_pk" PRIMARY KEY("current_focus_id","topic_id"),
	CONSTRAINT "current_focus_topics_position_unique" UNIQUE("current_focus_id","position")
);
--> statement-breakpoint
ALTER TABLE "profile"."current_focus" ADD CONSTRAINT "current_focus_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "profile"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."current_focus_topics" ADD CONSTRAINT "current_focus_topics_current_focus_id_current_focus_id_fk" FOREIGN KEY ("current_focus_id") REFERENCES "profile"."current_focus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."current_focus_topics" ADD CONSTRAINT "current_focus_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "profile"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "current_focus_project_id_index" ON "profile"."current_focus" USING btree ("project_id");