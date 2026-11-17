ALTER TABLE "profile"."persons" ADD COLUMN "services_intro" text;--> statement-breakpoint
ALTER TABLE "profile"."persons" ADD COLUMN "collaboration_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profile"."persons" ADD COLUMN "services_note" text;