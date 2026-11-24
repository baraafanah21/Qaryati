-- population_record -> claim (docs/data-model.md, "Fact tables: one pattern for all").
-- The composite key ties each row to a POPULATION claim; a hard-deleted claim takes
-- its value with it. Cross-module, so raw SQL (docs/database.md). The primary key
-- index on claim_id serves this foreign key, so no extra index is needed.

ALTER TABLE "population_record"
ADD CONSTRAINT "population_record_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
