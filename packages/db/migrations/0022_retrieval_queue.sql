CREATE TABLE "retrieval"."embeddings" (
	"text_hash" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	CONSTRAINT "embeddings_text_hash_model_model_version_pk" PRIMARY KEY("text_hash","model","model_version")
);
--> statement-breakpoint
ALTER TABLE "retrieval"."sources" ADD COLUMN "stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retrieval"."work_items" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "retrieval"."work_items_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
-- Vectors already stored with chunks seed the embedding cache, so nothing indexed is embedded again.
INSERT INTO "retrieval"."embeddings" ("text_hash", "model", "model_version", "embedding")
SELECT DISTINCT ON ("text_hash", "model", "model_version") "text_hash", "model", "model_version", "embedding"
FROM "retrieval"."chunks"
ORDER BY "text_hash", "model", "model_version"
ON CONFLICT DO NOTHING;
