ALTER TABLE "claim"
ADD CONSTRAINT "claim_village_id_fk"
FOREIGN KEY ("village_id")
REFERENCES "public"."village"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "claim"
ADD CONSTRAINT "claim_created_by_fk"
FOREIGN KEY ("created_by")
REFERENCES "public"."user_account"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "claim"
ADD CONSTRAINT "claim_reviewed_by_fk"
FOREIGN KEY ("reviewed_by")
REFERENCES "public"."user_account"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE UNIQUE INDEX "claim_no_duplicate"
ON "claim" ("group_key", "value_hash", "source_id")
NULLS NOT DISTINCT
WHERE "status" <> 'WITHDRAWN';