-- economy fact tables -> claim (docs/data-model.md, "Fact tables: one pattern for all").
-- Each composite key ties a row to a claim of its own type; a hard-deleted claim takes
-- its value with it. Cross-module, so raw SQL (docs/database.md). The primary key
-- index on claim_id serves each foreign key, so no extra index is needed.

ALTER TABLE "village_product"
ADD CONSTRAINT "village_product_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "facility"
ADD CONSTRAINT "facility_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
