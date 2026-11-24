CREATE TABLE "population_record" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"claim_type" text DEFAULT 'POPULATION' NOT NULL,
	"population" integer NOT NULL,
	"reference_year" smallint NOT NULL,
	"count_type" text NOT NULL,
	CONSTRAINT "population_record_claim_type_check" CHECK ("population_record"."claim_type" = 'POPULATION')
);
