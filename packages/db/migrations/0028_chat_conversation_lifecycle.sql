CREATE TABLE "chat"."operation_tombstones" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"verifier" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."telemetry_deletions" (
	"trace_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "telemetry_deletions_state_known" CHECK ("chat"."telemetry_deletions"."state" IN ('pending', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "chat"."telemetry_references" (
	"trace_id" text PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"operation_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat"."operations" DROP CONSTRAINT "operations_identity_request";--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP CONSTRAINT "messages_status_known";--> statement-breakpoint
ALTER TABLE "chat"."operations" DROP CONSTRAINT "operations_status_known";--> statement-breakpoint
ALTER TABLE "chat"."challenge_redemptions" DROP CONSTRAINT "challenge_redemptions_operation_id_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "chat"."challenge_redemptions" ALTER COLUMN "operation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."challenge_redemptions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "chat"."challenge_redemptions" SET "expires_at" = "redeemed_at" + interval '1 day';--> statement-breakpoint
ALTER TABLE "chat"."challenge_redemptions" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "attempt_key" uuid;--> statement-breakpoint
UPDATE "chat"."operations" SET "attempt_key" = "request_id";--> statement-breakpoint
ALTER TABLE "chat"."operations" ALTER COLUMN "attempt_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "retry_of" uuid;--> statement-breakpoint
CREATE INDEX "operation_tombstones_expiry" ON "chat"."operation_tombstones" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "telemetry_deletions_pending" ON "chat"."telemetry_deletions" USING btree ("requested_at") WHERE "chat"."telemetry_deletions"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "telemetry_references_conversation" ON "chat"."telemetry_references" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "chat"."challenge_redemptions" ADD CONSTRAINT "challenge_redemptions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "chat"."operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_redemptions_expiry" ON "chat"."challenge_redemptions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "operations_identity_request" ON "chat"."operations" USING btree ("identity_id","request_id");--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_identity_attempt" UNIQUE("identity_id","attempt_key");--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_status_known" CHECK ("chat"."messages"."status" IN ('pending', 'completed', 'failed', 'interrupted', 'cancelled'));--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_status_known" CHECK ("chat"."operations"."status" IN ('accepted', 'running', 'completed', 'failed', 'interrupted', 'cancelled'));
