-- Village fact tables -> claim (docs/data-model.md, "Fact tables: one pattern for all").
-- The composite key ties each fact row to a claim of its own type; a hard-deleted
-- claim takes its value with it. Cross-module, so raw SQL (docs/database.md).

ALTER TABLE "village_name"
ADD CONSTRAINT "village_name_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "name_origin"
ADD CONSTRAINT "name_origin_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "village_affiliation"
ADD CONSTRAINT "village_affiliation_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "village_location"
ADD CONSTRAINT "village_location_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "village_measure"
ADD CONSTRAINT "village_measure_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "village_relation"
ADD CONSTRAINT "village_relation_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
