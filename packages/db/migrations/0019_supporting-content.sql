CREATE TABLE "ai_roadmap"."followed_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"link" text,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followed_sources_slug_unique" UNIQUE("slug"),
	CONSTRAINT "followed_sources_position_not_negative" CHECK ("ai_roadmap"."followed_sources"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"term" text NOT NULL,
	"description" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "glossary_terms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "glossary_terms_position_not_negative" CHECK ("ai_roadmap"."glossary_terms"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."project_idea_topics" (
	"project_idea_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_idea_topics_project_idea_id_topic_id_pk" PRIMARY KEY("project_idea_id","topic_id"),
	CONSTRAINT "project_idea_topics_position_unique" UNIQUE("project_idea_id","position")
);
--> statement-breakpoint
CREATE TABLE "ai_roadmap"."project_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"how_to_start" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_ideas_slug_unique" UNIQUE("slug"),
	CONSTRAINT "project_ideas_position_not_negative" CHECK ("ai_roadmap"."project_ideas"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_roadmap"."project_idea_topics" ADD CONSTRAINT "project_idea_topics_project_idea_id_project_ideas_id_fk" FOREIGN KEY ("project_idea_id") REFERENCES "ai_roadmap"."project_ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."project_idea_topics" ADD CONSTRAINT "project_idea_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "profile"."topics"("id") ON DELETE no action ON UPDATE no action;