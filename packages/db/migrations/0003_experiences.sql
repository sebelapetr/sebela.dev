CREATE TYPE "profile"."experience_kind" AS ENUM('main_job', 'side_project', 'own_business');--> statement-breakpoint
CREATE TABLE "profile"."experience_technologies" (
	"experience_id" uuid NOT NULL,
	"technology_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "experience_technologies_experience_id_technology_id_pk" PRIMARY KEY("experience_id","technology_id"),
	CONSTRAINT "experience_technologies_position_unique" UNIQUE("experience_id","position")
);
--> statement-breakpoint
CREATE TABLE "profile"."experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" "profile"."experience_kind" NOT NULL,
	"organization_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"summary" text NOT NULL,
	"responsibilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_cv" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_slug_unique" UNIQUE("slug"),
	CONSTRAINT "experiences_period_is_ordered" CHECK ("profile"."experiences"."ended_on" IS NULL OR "profile"."experiences"."ended_on" >= "profile"."experiences"."started_on")
);
--> statement-breakpoint
ALTER TABLE "profile"."experience_technologies" ADD CONSTRAINT "experience_technologies_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "profile"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."experience_technologies" ADD CONSTRAINT "experience_technologies_technology_id_technologies_id_fk" FOREIGN KEY ("technology_id") REFERENCES "profile"."technologies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."experiences" ADD CONSTRAINT "experiences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "profile"."organizations"("id") ON DELETE no action ON UPDATE no action;