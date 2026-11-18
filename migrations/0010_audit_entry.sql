CREATE TABLE "audit_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"village_id" uuid,
	"actor_id" uuid,
	"request_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_entry_entity_idx" ON "audit_entry" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_entry_village_idx" ON "audit_entry" USING btree ("village_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_entry_actor_idx" ON "audit_entry" USING btree ("actor_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_entry_occurred_idx" ON "audit_entry" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);