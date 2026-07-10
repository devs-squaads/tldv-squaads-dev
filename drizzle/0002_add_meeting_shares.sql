CREATE TYPE "public"."share_type" AS ENUM('public', 'restricted_email');
--> statement-breakpoint
CREATE TYPE "public"."share_access_result" AS ENUM('granted', 'denied', 'expired', 'revoked', 'invalid');
--> statement-breakpoint
CREATE TABLE "meeting_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"share_type" "share_type" NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email" text,
	"recipient_email_normalized" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_share_access_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_share_id" text NOT NULL,
	"result" "share_access_result" NOT NULL,
	"ip_hash" text,
	"user_agent_hash" text,
	"accessed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_shares_token_hash_uq" ON "meeting_shares" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "meeting_shares_meeting_id_idx" ON "meeting_shares" USING btree ("meeting_id");
--> statement-breakpoint
CREATE INDEX "meeting_shares_type_idx" ON "meeting_shares" USING btree ("share_type");
--> statement-breakpoint
CREATE INDEX "meeting_shares_expires_at_idx" ON "meeting_shares" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "meeting_share_access_logs_share_id_idx" ON "meeting_share_access_logs" USING btree ("meeting_share_id");
