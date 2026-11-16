CREATE TABLE "profile"."testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"experience_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"author_name" text NOT NULL,
	"author_role" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "testimonials_slug_unique" UNIQUE("slug"),
	CONSTRAINT "testimonials_position_not_negative" CHECK ("profile"."testimonials"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "profile"."testimonials" ADD CONSTRAINT "testimonials_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "profile"."experiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "testimonials_experience_id_index" ON "profile"."testimonials" USING btree ("experience_id");