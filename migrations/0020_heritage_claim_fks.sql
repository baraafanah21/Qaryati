-- heritage fact tables -> claim (docs/data-model.md, "Fact tables: one pattern for all").
-- Each composite key ties a row to a claim of its own type; a hard-deleted claim takes
-- its value with it. Cross-module, so raw SQL (docs/database.md). The primary key
-- index on claim_id serves each foreign key, so no extra index is needed.

ALTER TABLE "history_overview"
ADD CONSTRAINT "history_overview_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "historical_event"
ADD CONSTRAINT "historical_event_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "landmark"
ADD CONSTRAINT "landmark_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "cultural_item"
ADD CONSTRAINT "cultural_item_claim_fk"
FOREIGN KEY ("claim_id", "claim_type")
REFERENCES "public"."claim"("id", "claim_type")
ON DELETE CASCADE ON UPDATE NO ACTION;
