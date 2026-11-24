CREATE TABLE "facility" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'FACILITY' NOT NULL,
	"facility_type" text NOT NULL,
	"name" text NOT NULL,
	"location" geography(Point,4326),
	"established_year" smallint,
	CONSTRAINT "facility_claim_type_check" CHECK ("facility"."claim_type" = 'FACILITY')
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "village_product" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'VILLAGE_PRODUCT' NOT NULL,
	"product_id" uuid NOT NULL,
	"significance" text NOT NULL,
	CONSTRAINT "village_product_claim_type_check" CHECK ("village_product"."claim_type" = 'VILLAGE_PRODUCT')
);
--> statement-breakpoint
ALTER TABLE "village_product" ADD CONSTRAINT "village_product_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_location_gist" ON "facility" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "product_code_key" ON "product" USING btree ("code");--> statement-breakpoint
CREATE INDEX "product_category_idx" ON "product" USING btree ("category");--> statement-breakpoint
CREATE INDEX "village_product_product_id_idx" ON "village_product" USING btree ("product_id");