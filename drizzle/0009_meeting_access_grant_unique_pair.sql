CREATE UNIQUE INDEX "meeting_access_grants_meeting_grantee_unique_idx" ON "meeting_access_grants" ("meeting_id", "grantee_user_id");
