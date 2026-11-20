CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "audit"."content_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit"."content_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"provenance" text,
	"entity" text NOT NULL,
	"record" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	CONSTRAINT "content_changes_method_is_write" CHECK ("audit"."content_changes"."method" IN ('POST', 'PATCH', 'DELETE')),
	CONSTRAINT "content_changes_action_known" CHECK ("audit"."content_changes"."action" IN ('created', 'updated', 'deleted')),
	CONSTRAINT "content_changes_provenance_bounded" CHECK ("audit"."content_changes"."provenance" IS NULL OR char_length("audit"."content_changes"."provenance") BETWEEN 1 AND 64),
	CONSTRAINT "content_changes_names_bounded" CHECK (char_length("audit"."content_changes"."operation_id") BETWEEN 1 AND 100 AND char_length("audit"."content_changes"."route") BETWEEN 1 AND 200 AND char_length("audit"."content_changes"."entity") BETWEEN 1 AND 50 AND ("audit"."content_changes"."record" IS NULL OR char_length("audit"."content_changes"."record") BETWEEN 1 AND 200)),
	CONSTRAINT "content_changes_has_state" CHECK ("audit"."content_changes"."before" IS NOT NULL OR "audit"."content_changes"."after" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audit"."content_changes" ADD CONSTRAINT "content_changes_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "auth"."api_keys"("id") ON DELETE no action ON UPDATE no action;