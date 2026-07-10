CREATE TYPE "public"."authorized_account_role" AS ENUM('admin', 'member');
--> statement-breakpoint
CREATE TABLE "authorized_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "authorized_account_role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "authorized_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
-- Backfill: every user who could already log in before this change keeps access,
-- so the allowlist gate below doesn't lock out the existing team on deploy.
INSERT INTO "authorized_accounts" ("id", "email", "role", "is_active", "invited_by", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "email", 'member', true, NULL, now(), now()
FROM "users"
ON CONFLICT ("email") DO NOTHING;
