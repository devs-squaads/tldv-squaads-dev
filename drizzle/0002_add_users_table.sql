CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text NOT NULL UNIQUE,
  "image" text,
  "google_access_token" text,
  "google_refresh_token" text,
  "google_token_expiry" timestamp with time zone,
  "calendar_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
