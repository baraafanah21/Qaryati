CREATE TABLE "cultural_item" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'CULTURAL_ITEM' NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "cultural_item_claim_type_check" CHECK ("cultural_item"."claim_type" = 'CULTURAL_ITEM')
);
--> statement-breakpoint
CREATE TABLE "historical_event" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'HISTORICAL_EVENT' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"date_precision" text NOT NULL,
	CONSTRAINT "historical_event_claim_type_check" CHECK ("historical_event"."claim_type" = 'HISTORICAL_EVENT')
);
--> statement-breakpoint
CREATE TABLE "history_overview" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'HISTORY_OVERVIEW' NOT NULL,
	"summary" text NOT NULL,
	CONSTRAINT "history_overview_claim_type_check" CHECK ("history_overview"."claim_type" = 'HISTORY_OVERVIEW')
);
--> statement-breakpoint
CREATE TABLE "landmark" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'LANDMARK' NOT NULL,
	"name" text NOT NULL,
	"landmark_type" text NOT NULL,
	"description" text,
	"location" geography(Point,4326),
	"era" text,
	CONSTRAINT "landmark_claim_type_check" CHECK ("landmark"."claim_type" = 'LANDMARK')
);
--> statement-breakpoint
CREATE INDEX "landmark_location_gist" ON "landmark" USING gist ("location");