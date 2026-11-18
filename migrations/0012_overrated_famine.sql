ALTER TABLE "refresh_token" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_replaced_by_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."refresh_token"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_token_replaced_by_id_idx" ON "refresh_token" USING btree ("replaced_by_id");