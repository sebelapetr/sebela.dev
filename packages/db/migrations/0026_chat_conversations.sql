CREATE SCHEMA "chat";
--> statement-breakpoint
CREATE TABLE "chat"."admissions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat"."admissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"identity_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."challenge_redemptions" (
	"digest" text PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversations_identity_id_unique" UNIQUE("identity_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."deletions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat"."deletions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deleted_at" timestamp with time zone NOT NULL,
	"conversations" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."grants" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat"."identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verifier" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identities_verifier_unique" UNIQUE("verifier")
);
--> statement-breakpoint
CREATE TABLE "chat"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat"."messages_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"request_id" uuid NOT NULL,
	"status" text NOT NULL,
	"text" text,
	"outcome" text,
	"error_code" text,
	"error_retryable" boolean,
	"language" text,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messages_role_known" CHECK ("chat"."messages"."role" IN ('user', 'assistant')),
	CONSTRAINT "messages_status_known" CHECK ("chat"."messages"."status" IN ('pending', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "messages_user_has_text" CHECK ("chat"."messages"."role" <> 'user' OR ("chat"."messages"."text" IS NOT NULL AND "chat"."messages"."status" = 'completed'))
);
--> statement-breakpoint
CREATE TABLE "chat"."operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"question_hash" text NOT NULL,
	"user_message_id" uuid NOT NULL,
	"assistant_message_id" uuid NOT NULL,
	"status" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"model" text NOT NULL,
	"pricing_version" text NOT NULL,
	"allowance_micro_usd" bigint NOT NULL,
	"context_revision" integer NOT NULL,
	"result_outcome" text,
	"result_reason" text,
	"cost_micro_usd" bigint,
	"cost_uncertain" boolean,
	"input_tokens" integer,
	"output_tokens" integer,
	"model_attempts" integer,
	"latency_ms" integer,
	"versions" jsonb,
	CONSTRAINT "operations_identity_request" UNIQUE("identity_id","request_id"),
	CONSTRAINT "operations_status_known" CHECK ("chat"."operations"."status" IN ('accepted', 'running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "operations_allowance_positive" CHECK ("chat"."operations"."allowance_micro_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "chat"."spend_reservations" (
	"operation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"state" text NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spend_reservations_operation_id_kind_starts_on_pk" PRIMARY KEY("operation_id","kind","starts_on"),
	CONSTRAINT "spend_reservations_state_known" CHECK ("chat"."spend_reservations"."state" IN ('reserved', 'settled', 'released', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "chat"."spend_windows" (
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"committed_micro_usd" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "spend_windows_kind_starts_on_pk" PRIMARY KEY("kind","starts_on"),
	CONSTRAINT "spend_windows_kind_known" CHECK ("chat"."spend_windows"."kind" IN ('day', 'month')),
	CONSTRAINT "spend_windows_committed_nonnegative" CHECK ("chat"."spend_windows"."committed_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chat"."admissions" ADD CONSTRAINT "admissions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "chat"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."challenge_redemptions" ADD CONSTRAINT "challenge_redemptions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "chat"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversations_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "chat"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."grants" ADD CONSTRAINT "grants_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "chat"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "chat"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "chat"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "chat"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admissions_identity" ON "chat"."admissions" USING btree ("identity_id","admitted_at");--> statement-breakpoint
CREATE INDEX "admissions_fingerprint" ON "chat"."admissions" USING btree ("fingerprint","admitted_at");--> statement-breakpoint
CREATE INDEX "admissions_expiry" ON "chat"."admissions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_position" ON "chat"."messages" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_one_active_per_identity" ON "chat"."operations" USING btree ("identity_id") WHERE "chat"."operations"."status" IN ('accepted', 'running');--> statement-breakpoint
CREATE INDEX "operations_active_deadline" ON "chat"."operations" USING btree ("deadline_at") WHERE "chat"."operations"."status" IN ('accepted', 'running');