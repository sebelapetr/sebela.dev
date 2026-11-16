ALTER TABLE "profile"."media" ADD COLUMN "sha256" text;--> statement-breakpoint
CREATE INDEX "media_sha256_index" ON "profile"."media" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "profile"."media" ADD CONSTRAINT "media_sha256_format" CHECK ("profile"."media"."sha256" ~ '^[0-9a-f]{64}$');