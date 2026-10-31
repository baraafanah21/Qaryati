-- Custom SQL migration file, put your code below! --
ALTER TABLE "source" ADD CONSTRAINT "source_created_by_user_account_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
