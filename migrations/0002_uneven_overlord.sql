CREATE TABLE "source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"publisher" text,
	"published_year" smallint,
	"url" text,
	"isbn" text,
	"reliability" smallint NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "source_type_check" CHECK ("source"."source_type" IN (
        'BOOK', 'ARTICLE', 'CENSUS', 'GOV_DATASET',
        'ARCHIVE', 'ORAL_HISTORY', 'WEBSITE', 'EXTERNAL_API'
      )),
	CONSTRAINT "source_title_check" CHECK (char_length("source"."title") BETWEEN 1 AND 300),
	CONSTRAINT "source_reliability_check" CHECK ("source"."reliability" BETWEEN 1 AND 5),
	CONSTRAINT "source_published_year_check" CHECK ("source"."published_year" BETWEEN 1000 AND 2100),
	CONSTRAINT "source_url_length_check" CHECK (char_length("source"."url") <= 2048),
	CONSTRAINT "source_url_scheme_check" CHECK ("source"."url" ~* '^https?://'),
	CONSTRAINT "source_notes_check" CHECK (char_length("source"."notes") <= 2000),
	CONSTRAINT "source_isbn_check" CHECK ("source"."isbn" ~ '^([0-9]{9}[0-9X]|[0-9]{13})$'),
	CONSTRAINT "source_version_check" CHECK ("source"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_url_key" ON "source" USING btree ("url") WHERE "source"."url" IS NOT NULL AND "source"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "source_isbn_key" ON "source" USING btree ("isbn") WHERE "source"."isbn" IS NOT NULL AND "source"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "source_type_idx" ON "source" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "source_title_trgm_idx" ON "source" USING gin ("title" gin_trgm_ops);