CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "chat_messages_user_id_idx"
  ON "chat_messages" ("user_id", "created_at" DESC);
