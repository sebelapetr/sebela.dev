CREATE TABLE "ai_roadmap"."books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"description" text,
	"pages" integer,
	"year" integer,
	"isbn" text,
	"priority" integer NOT NULL,
	"started_on" date,
	"ended_on" date,
	"summary" text,
	"cover_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_slug_unique" UNIQUE("slug"),
	CONSTRAINT "books_priority_not_negative" CHECK ("ai_roadmap"."books"."priority" >= 0),
	CONSTRAINT "books_pages_positive" CHECK ("ai_roadmap"."books"."pages" IS NULL OR "ai_roadmap"."books"."pages" > 0),
	CONSTRAINT "books_period_is_ordered" CHECK ("ai_roadmap"."books"."started_on" IS NULL OR "ai_roadmap"."books"."ended_on" IS NULL OR "ai_roadmap"."books"."ended_on" >= "ai_roadmap"."books"."started_on")
);
--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resources" ADD COLUMN "book_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."books" ADD CONSTRAINT "books_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "profile"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resources" ADD CONSTRAINT "resources_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "ai_roadmap"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resources" ADD CONSTRAINT "resources_book_id_unique" UNIQUE("book_id");--> statement-breakpoint
ALTER TABLE "ai_roadmap"."resources" ADD CONSTRAINT "resources_book_needs_book_type" CHECK ("ai_roadmap"."resources"."book_id" IS NULL OR "ai_roadmap"."resources"."type" = 'book');