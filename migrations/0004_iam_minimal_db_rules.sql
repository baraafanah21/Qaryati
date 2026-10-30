ALTER TABLE "refresh_token" DROP CONSTRAINT "refresh_token_token_hash_check";--> statement-breakpoint
ALTER TABLE "refresh_token" DROP CONSTRAINT "refresh_token_expiry_check";--> statement-breakpoint
ALTER TABLE "user_account" DROP CONSTRAINT "user_account_role_check";--> statement-breakpoint
ALTER TABLE "user_account" DROP CONSTRAINT "user_account_status_check";--> statement-breakpoint
ALTER TABLE "user_account" DROP CONSTRAINT "user_account_version_check";--> statement-breakpoint
ALTER TABLE "user_account" DROP COLUMN "deleted_at";