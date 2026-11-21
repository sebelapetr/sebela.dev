CREATE TABLE "retrieval"."document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "retrieval"."document_versions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"title" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text,
	"status" text NOT NULL,
	"findings" jsonb NOT NULL,
	"section_count" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "document_versions_content_hash_unique" UNIQUE("content_hash"),
	CONSTRAINT "document_versions_hash_hex" CHECK ("retrieval"."document_versions"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_versions_source_bounded" CHECK (char_length("retrieval"."document_versions"."source_id") BETWEEN 1 AND 200),
	CONSTRAINT "document_versions_title_bounded" CHECK (char_length("retrieval"."document_versions"."title") BETWEEN 1 AND 300),
	CONSTRAINT "document_versions_status_known" CHECK ("retrieval"."document_versions"."status" IN ('pending', 'blocked', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "document_versions_counts_not_negative" CHECK ("retrieval"."document_versions"."byte_size" >= 0 AND "retrieval"."document_versions"."section_count" >= 0 AND "retrieval"."document_versions"."chunk_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "document_versions_source" ON "retrieval"."document_versions" USING btree ("source_id","status");