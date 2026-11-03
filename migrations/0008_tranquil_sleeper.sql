CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text NOT NULL,
	"village_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"value_hash" text NOT NULL,
	"source_id" uuid,
	"source_locator" text,
	"status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"supersedes_id" uuid,
	"created_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "claim_id_type_unique" UNIQUE("id","claim_type"),
	CONSTRAINT "claim_preferred_verified_check" CHECK (NOT "claim"."is_preferred" OR "claim"."status" = 'VERIFIED'),
	CONSTRAINT "claim_verified_source_check" CHECK ("claim"."status" <> 'VERIFIED' OR "claim"."source_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_supersedes_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."claim"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_one_preferred" ON "claim" USING btree ("group_key") WHERE "claim"."is_preferred";--> statement-breakpoint
CREATE INDEX "claim_review_queue" ON "claim" USING btree ("status","created_at") WHERE "claim"."status" IN ('UNVERIFIED', 'DISPUTED');--> statement-breakpoint
CREATE INDEX "claim_village_published" ON "claim" USING btree ("village_id","claim_type") WHERE "claim"."is_preferred";--> statement-breakpoint
CREATE INDEX "claim_group" ON "claim" USING btree ("group_key");--> statement-breakpoint
CREATE INDEX "claim_village_id_idx" ON "claim" USING btree ("village_id");--> statement-breakpoint
CREATE INDEX "claim_source_id_idx" ON "claim" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "claim_supersedes_id_idx" ON "claim" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "claim_created_by_idx" ON "claim" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "claim_reviewed_by_idx" ON "claim" USING btree ("reviewed_by");