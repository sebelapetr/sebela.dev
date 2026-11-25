ALTER TABLE "chat"."operations" ALTER COLUMN "user_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."operations" ALTER COLUMN "assistant_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "chat"."conversations" ADD COLUMN "summary_through_position" bigint;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "kind" text DEFAULT 'answer' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "compaction_kept" integer;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "compaction_summary_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD COLUMN "compaction_next_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "chat"."operations" ADD CONSTRAINT "operations_kind_messages" CHECK (("chat"."operations"."kind" = 'answer' AND "chat"."operations"."user_message_id" IS NOT NULL AND "chat"."operations"."assistant_message_id" IS NOT NULL) OR ("chat"."operations"."kind" = 'compaction' AND "chat"."operations"."user_message_id" IS NULL AND "chat"."operations"."assistant_message_id" IS NULL));