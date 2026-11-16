CREATE TYPE "profile"."service_evidence_kind" AS ENUM('project', 'exploration', 'link');--> statement-breakpoint
CREATE TABLE "profile"."service_evidence" (
	"service_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "profile"."service_evidence_kind" NOT NULL,
	"project_id" uuid,
	"exploration_id" uuid,
	"link_label" text,
	"link_path" text,
	CONSTRAINT "service_evidence_service_id_position_pk" PRIMARY KEY("service_id","position"),
	CONSTRAINT "service_evidence_matches_kind" CHECK (CASE "profile"."service_evidence"."kind"
        WHEN 'project' THEN "profile"."service_evidence"."project_id" IS NOT NULL AND "profile"."service_evidence"."exploration_id" IS NULL
          AND "profile"."service_evidence"."link_label" IS NULL AND "profile"."service_evidence"."link_path" IS NULL
        WHEN 'exploration' THEN "profile"."service_evidence"."exploration_id" IS NOT NULL AND "profile"."service_evidence"."project_id" IS NULL
          AND "profile"."service_evidence"."link_label" IS NULL AND "profile"."service_evidence"."link_path" IS NULL
        ELSE "profile"."service_evidence"."link_label" IS NOT NULL AND "profile"."service_evidence"."link_path" IS NOT NULL
          AND "profile"."service_evidence"."project_id" IS NULL AND "profile"."service_evidence"."exploration_id" IS NULL
      END)
);
--> statement-breakpoint
CREATE TABLE "profile"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"audience" text NOT NULL,
	"deliverable" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_slug_unique" UNIQUE("slug"),
	CONSTRAINT "services_position_not_negative" CHECK ("profile"."services"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "profile"."service_evidence" ADD CONSTRAINT "service_evidence_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "profile"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."service_evidence" ADD CONSTRAINT "service_evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "profile"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."service_evidence" ADD CONSTRAINT "service_evidence_exploration_id_explorations_id_fk" FOREIGN KEY ("exploration_id") REFERENCES "profile"."explorations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_evidence_project_id_index" ON "profile"."service_evidence" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "service_evidence_exploration_id_index" ON "profile"."service_evidence" USING btree ("exploration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_evidence_project_unique" ON "profile"."service_evidence" USING btree ("service_id","project_id") WHERE "profile"."service_evidence"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_evidence_exploration_unique" ON "profile"."service_evidence" USING btree ("service_id","exploration_id") WHERE "profile"."service_evidence"."exploration_id" IS NOT NULL;