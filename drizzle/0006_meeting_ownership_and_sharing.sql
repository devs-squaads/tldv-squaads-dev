-- Revoke existing "public" shares (spec requirement).
UPDATE "meeting_shares" SET "revoked_at" = COALESCE("revoked_at", now()), "updated_at" = now()
WHERE "share_type" = 'public';
--> statement-breakpoint
-- Relabel them to a value that survives the new enum. Safe because resolvePublicShare()
-- checks revokedAt before ever branching on shareType — a revoked row's shareType is inert.
UPDATE "meeting_shares" SET "share_type" = 'restricted_email' WHERE "share_type" = 'public'::"public"."share_type";
--> statement-breakpoint
-- Recreate the enum without "public" (Postgres cannot ALTER TYPE ... DROP VALUE) and repoint the column.
ALTER TYPE "public"."share_type" RENAME TO "share_type_old";
--> statement-breakpoint
CREATE TYPE "public"."share_type" AS ENUM('restricted_email');
--> statement-breakpoint
ALTER TABLE "meeting_shares" ALTER COLUMN "share_type" TYPE "public"."share_type" USING "share_type"::text::"public"."share_type";
--> statement-breakpoint
DROP TYPE "public"."share_type_old";
--> statement-breakpoint
-- Owner is mandatory going forward. Existing rows are test data (Migration Note in
-- spec.md) and this repo resets the DB alongside this migration, so no backfill/default is needed.
ALTER TABLE "meetings" ADD COLUMN "owner_id" text NOT NULL REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recording_storage_key" text;
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "participant_emails" jsonb;
--> statement-breakpoint
CREATE TABLE "meeting_access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"grantee_user_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_access_grants" ENABLE ROW LEVEL SECURITY;
