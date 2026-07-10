CREATE TYPE "public"."meeting_status" AS ENUM('pending', 'recording', 'transcribing', 'summarizing', 'completed', 'error');
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"bot_name" text,
	"status" "meeting_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"raw_transcription" text,
	"summary" text,
	"recording_file_path" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"duration_minutes" integer DEFAULT 60,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text
);
