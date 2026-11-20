-- pgvector is created by the superuser where a role may not; unaccent is a trusted extension.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE SCHEMA "retrieval";
--> statement-breakpoint
CREATE TABLE "retrieval"."chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"search" "tsvector" NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"dimension" integer NOT NULL,
	CONSTRAINT "chunks_ordinal_per_version" UNIQUE("version_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "retrieval"."provider_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"tokens" integer NOT NULL,
	"cost_usd" numeric(14, 8) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_usage_operation_known" CHECK ("retrieval"."provider_usage"."operation" IN ('index', 'search', 'candidates')),
	CONSTRAINT "provider_usage_not_negative" CHECK ("retrieval"."provider_usage"."tokens" >= 0 AND "retrieval"."provider_usage"."cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retrieval"."sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading_path" text[] NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	CONSTRAINT "sections_ordinal_per_version" UNIQUE("version_id","ordinal"),
	CONSTRAINT "sections_span_ordered" CHECK (0 <= "retrieval"."sections"."start" AND "retrieval"."sections"."start" <= "retrieval"."sections"."end")
);
--> statement-breakpoint
CREATE TABLE "retrieval"."sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"content_kind" text NOT NULL,
	CONSTRAINT "sources_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "sources_kind_known" CHECK ("retrieval"."sources"."source_kind" IN ('portfolio', 'supplemental')),
	CONSTRAINT "sources_id_bounded" CHECK (char_length("retrieval"."sources"."source_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "retrieval"."versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"path" text,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"dimension" integer NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "versions_one_per_source" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "retrieval"."work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_operation_known" CHECK ("retrieval"."work_items"."operation" IN ('index', 'remove')),
	CONSTRAINT "work_items_status_known" CHECK ("retrieval"."work_items"."status" IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "retrieval"."chunks" ADD CONSTRAINT "chunks_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "retrieval"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunks" ADD CONSTRAINT "chunks_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "retrieval"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."sections" ADD CONSTRAINT "sections_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "retrieval"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."versions" ADD CONSTRAINT "versions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "retrieval"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "retrieval"."chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_search_gin" ON "retrieval"."chunks" USING gin ("search");--> statement-breakpoint
CREATE INDEX "chunks_text_hash_model" ON "retrieval"."chunks" USING btree ("text_hash","model","model_version");--> statement-breakpoint
CREATE INDEX "provider_usage_occurred_at" ON "retrieval"."provider_usage" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "work_items_status" ON "retrieval"."work_items" USING btree ("status","created_at");