ALTER TABLE "admin_unit" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_unit" ADD COLUMN "created_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_unit" ADD COLUMN "updated_at" timestamp with time zone NOT NULL;