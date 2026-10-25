CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "refresh_token_token_hash_check" CHECK ("refresh_token"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refresh_token_expiry_check" CHECK ("refresh_token"."expires_at" > "refresh_token"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'CONTRIBUTOR' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_account_role_check" CHECK ("user_account"."role" IN ('CONTRIBUTOR', 'EDITOR', 'ADMIN')),
	CONSTRAINT "user_account_status_check" CHECK ("user_account"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "user_account_version_check" CHECK ("user_account"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_email_key" ON "user_account" USING btree ("email");