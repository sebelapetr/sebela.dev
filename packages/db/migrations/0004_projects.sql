CREATE TABLE "profile"."project_technologies" (
	"project_id" uuid NOT NULL,
	"technology_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_technologies_project_id_technology_id_pk" PRIMARY KEY("project_id","technology_id"),
	CONSTRAINT "project_technologies_position_unique" UNIQUE("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "profile"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"experience_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"problem" text NOT NULL,
	"work_done" text NOT NULL,
	"result" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_for_homepage" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "projects_position_not_negative" CHECK ("profile"."projects"."position" >= 0),
	CONSTRAINT "projects_period_is_ordered" CHECK ("profile"."projects"."ended_on" IS NULL OR "profile"."projects"."ended_on" >= "profile"."projects"."started_on")
);
--> statement-breakpoint
ALTER TABLE "profile"."project_technologies" ADD CONSTRAINT "project_technologies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "profile"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."project_technologies" ADD CONSTRAINT "project_technologies_technology_id_technologies_id_fk" FOREIGN KEY ("technology_id") REFERENCES "profile"."technologies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."projects" ADD CONSTRAINT "projects_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "profile"."experiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_experience_id_index" ON "profile"."projects" USING btree ("experience_id");