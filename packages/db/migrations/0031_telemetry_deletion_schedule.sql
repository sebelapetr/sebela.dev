DROP INDEX "chat"."telemetry_deletions_pending";--> statement-breakpoint
-- The previous release inserts deletions without the new column, so it keeps a default.
ALTER TABLE "chat"."telemetry_deletions" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- An owed deletion is never sent before its trace's last possible export: 10 minutes.
UPDATE "chat"."telemetry_deletions" SET "next_attempt_at" = "requested_at" + interval '10 minutes' WHERE "state" = 'pending';--> statement-breakpoint
ALTER TABLE "chat"."telemetry_references" ADD COLUMN "export_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."telemetry_references" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "chat"."telemetry_references" SET "export_until" = "recorded_at" + interval '10 minutes', "expires_at" = "recorded_at" + interval '30 days';--> statement-breakpoint
ALTER TABLE "chat"."telemetry_references" ALTER COLUMN "export_until" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."telemetry_references" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "telemetry_deletions_due" ON "chat"."telemetry_deletions" USING btree ("next_attempt_at","trace_id") WHERE "chat"."telemetry_deletions"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "telemetry_references_expiry" ON "chat"."telemetry_references" USING btree ("expires_at","trace_id");
