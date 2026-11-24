CREATE TABLE "name_origin" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'NAME_ORIGIN' NOT NULL,
	"meaning" text NOT NULL,
	"origin_language" text,
	"explanation" text,
	CONSTRAINT "name_origin_claim_type_check" CHECK ("name_origin"."claim_type" = 'NAME_ORIGIN')
);
--> statement-breakpoint
CREATE TABLE "village_affiliation" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'AFFILIATION' NOT NULL,
	"admin_unit_id" uuid NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "village_affiliation_claim_type_check" CHECK ("village_affiliation"."claim_type" = 'AFFILIATION')
);
--> statement-breakpoint
CREATE TABLE "village_location" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'LOCATION' NOT NULL,
	"point" geography(Point,4326) NOT NULL,
	"precision" text NOT NULL,
	"description" text,
	CONSTRAINT "village_location_claim_type_check" CHECK ("village_location"."claim_type" = 'LOCATION')
);
--> statement-breakpoint
CREATE TABLE "village_measure" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'MEASURE' NOT NULL,
	"kind" text NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "village_measure_claim_type_check" CHECK ("village_measure"."claim_type" = 'MEASURE')
);
--> statement-breakpoint
CREATE TABLE "village_name" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'VILLAGE_NAME' NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"lang" text NOT NULL,
	"name_type" text NOT NULL,
	"period_from_year" smallint,
	"period_to_year" smallint,
	CONSTRAINT "village_name_claim_type_check" CHECK ("village_name"."claim_type" = 'VILLAGE_NAME')
);
--> statement-breakpoint
CREATE TABLE "village_relation" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'RELATION' NOT NULL,
	"related_village_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	CONSTRAINT "village_relation_claim_type_check" CHECK ("village_relation"."claim_type" = 'RELATION')
);
--> statement-breakpoint
ALTER TABLE "village_affiliation" ADD CONSTRAINT "village_affiliation_admin_unit_id_fk" FOREIGN KEY ("admin_unit_id") REFERENCES "public"."admin_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "village_relation" ADD CONSTRAINT "village_relation_related_village_id_fk" FOREIGN KEY ("related_village_id") REFERENCES "public"."village"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "village_affiliation_admin_unit_id_idx" ON "village_affiliation" USING btree ("admin_unit_id");--> statement-breakpoint
CREATE INDEX "village_relation_related_village_id_idx" ON "village_relation" USING btree ("related_village_id");