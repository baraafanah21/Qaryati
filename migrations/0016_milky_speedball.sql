CREATE INDEX "village_publication_display_name_en_idx" ON "village" USING btree ("publication_status","display_name_en");--> statement-breakpoint
CREATE INDEX "village_publication_created_at_idx" ON "village" USING btree ("publication_status","created_at");--> statement-breakpoint
CREATE INDEX "village_display_name_ar_trgm_idx" ON "village" USING gin ("display_name_ar" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "village_display_name_en_trgm_idx" ON "village" USING gin ("display_name_en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "village_name_name_normalized_trgm_idx" ON "village_name" USING gin ("name_normalized" gin_trgm_ops);