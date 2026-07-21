-- Pre-dedup step: production already has duplicate (source_provider, source_event_id) rows
-- (that's the bug this migration fixes), so CREATE UNIQUE INDEX below would fail against real
-- data. Keep the earliest row per pair (the one the worker would have claimed first) and delete
-- the rest before the index is created.
DELETE FROM "meetings" a USING "meetings" b
WHERE a."source_event_id" IS NOT NULL
  AND a."source_provider" = b."source_provider"
  AND a."source_event_id" = b."source_event_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_source_event_unique_idx" ON "meetings" ("source_provider", "source_event_id") WHERE "source_event_id" IS NOT NULL;
