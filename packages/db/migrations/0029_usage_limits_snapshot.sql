ALTER TABLE "chat"."admissions" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "context_estimated_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "context_reported_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "context_cap_tokens" integer;--> statement-breakpoint
CREATE INDEX "admissions_operation" ON "chat"."admissions" USING btree ("operation_id");