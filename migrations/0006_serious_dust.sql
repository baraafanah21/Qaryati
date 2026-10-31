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
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_url_key" ON "source" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "source_isbn_key" ON "source" USING btree ("isbn");--> statement-breakpoint
CREATE INDEX "source_type_idx" ON "source" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "source_created_by_idx" ON "source" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "source_title_trgm_idx" ON "source" USING gin ("title" gin_trgm_ops);