CREATE TYPE "profile"."media_type" AS ENUM('image/png', 'image/jpeg', 'image/webp', 'application/pdf');--> statement-breakpoint
CREATE TABLE "profile"."media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"media_type" "profile"."media_type" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_key_unique" UNIQUE("key"),
	CONSTRAINT "media_byte_size_positive" CHECK ("profile"."media"."byte_size" > 0),
	CONSTRAINT "media_dimensions_match_type" CHECK (("profile"."media"."media_type" = 'application/pdf' AND "profile"."media"."width" IS NULL AND "profile"."media"."height" IS NULL) OR ("profile"."media"."media_type" <> 'application/pdf' AND "profile"."media"."width" IS NOT NULL AND "profile"."media"."height" IS NOT NULL AND "profile"."media"."width" > 0 AND "profile"."media"."height" > 0))
);
--> statement-breakpoint
ALTER TABLE "profile"."organizations" ADD COLUMN "logo_id" uuid;--> statement-breakpoint
ALTER TABLE "profile"."persons" ADD COLUMN "photo_id" uuid;--> statement-breakpoint
ALTER TABLE "profile"."persons" ADD COLUMN "cv_pdf_id" uuid;--> statement-breakpoint
ALTER TABLE "profile"."projects" ADD COLUMN "cover_id" uuid;--> statement-breakpoint
ALTER TABLE "profile"."organizations" ADD CONSTRAINT "organizations_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "profile"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."persons" ADD CONSTRAINT "persons_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "profile"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."persons" ADD CONSTRAINT "persons_cv_pdf_id_media_id_fk" FOREIGN KEY ("cv_pdf_id") REFERENCES "profile"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile"."projects" ADD CONSTRAINT "projects_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "profile"."media"("id") ON DELETE no action ON UPDATE no action;