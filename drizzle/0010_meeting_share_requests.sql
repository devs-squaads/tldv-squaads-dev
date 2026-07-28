CREATE TYPE "public"."share_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."share_request_access_type" AS ENUM('single_use', 'temporary', 'permanent');
--> statement-breakpoint
CREATE TABLE "meeting_share_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"grantee_user_id" text,
	"recipient_email" text,
	"recipient_email_normalized" text,
	"access_type" "share_request_access_type" NOT NULL,
	"expires_in_days" integer,
	"status" "share_request_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolved_grant_id" text,
	"resolved_share_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "meeting_share_requests_grantee_xor_email" CHECK (("meeting_share_requests"."grantee_user_id" IS NOT NULL) <> ("meeting_share_requests"."recipient_email_normalized" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "meeting_share_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "msr_pending_grantee_uq" ON "meeting_share_requests" USING btree ("meeting_id","grantee_user_id") WHERE "meeting_share_requests"."status" = 'pending' AND "meeting_share_requests"."grantee_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "msr_pending_email_uq" ON "meeting_share_requests" USING btree ("meeting_id","recipient_email_normalized") WHERE "meeting_share_requests"."status" = 'pending' AND "meeting_share_requests"."recipient_email_normalized" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "meeting_shares" ADD COLUMN "single_use" boolean DEFAULT false NOT NULL;
