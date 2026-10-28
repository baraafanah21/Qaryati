CREATE TABLE "admin_unit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"parent_id" uuid,
	"unit_type" text NOT NULL,
	"authority_type" text,
	"era" text DEFAULT 'CURRENT' NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text
);
--> statement-breakpoint
CREATE TABLE "village" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"settlement_status" text NOT NULL,
	"publication_status" text DEFAULT 'DRAFT' NOT NULL,
	"display_name_ar" text NOT NULL,
	"display_name_en" text,
	"location" geography(Point,4326),
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_unit" ADD CONSTRAINT "admin_unit_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."admin_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_unit_code_key" ON "admin_unit" USING btree ("code");--> statement-breakpoint
CREATE INDEX "admin_unit_parent_id_idx" ON "admin_unit" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "admin_unit_unit_type_era_idx" ON "admin_unit" USING btree ("unit_type","era");--> statement-breakpoint
CREATE UNIQUE INDEX "village_slug_key" ON "village" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "village_created_by_idx" ON "village" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "village_location_gist" ON "village" USING gist ("location");--> statement-breakpoint
CREATE INDEX "village_publication_display_name_ar_idx" ON "village" USING btree ("publication_status","display_name_ar");