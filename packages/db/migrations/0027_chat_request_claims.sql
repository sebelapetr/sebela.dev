CREATE TABLE "chat"."request_claims" (
	"identity_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"question_hash" text NOT NULL,
	"challenge_digest" text NOT NULL,
	"state" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "request_claims_identity_id_request_id_pk" PRIMARY KEY("identity_id","request_id"),
	CONSTRAINT "request_claims_state_known" CHECK ("chat"."request_claims"."state" IN ('pending', 'verified', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "chat"."request_claims" ADD CONSTRAINT "request_claims_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "chat"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_claims_expiry" ON "chat"."request_claims" USING btree ("expires_at");