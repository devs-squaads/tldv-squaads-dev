import { pgEnum, pgTable, text, integer, timestamp, boolean, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  image: text("image"),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleTokenExpiry: timestamp("google_token_expiry", { withTimezone: true }),
  calendarEnabled: boolean("calendar_enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).enableRLS();

export const authorizedAccountRoleEnum = pgEnum("authorized_account_role", ["admin", "member"]);

export const authorizedAccounts = pgTable("authorized_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: authorizedAccountRoleEnum("role").default("member").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  invitedBy: text("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).enableRLS();

export const meetingStatusEnum = pgEnum("meeting_status", [
  "pending",
  "joining",
  "waiting_admission",
  "recording",
  "transcribing",
  "summarizing",
  "completed",
  "admission_timeout",
  "error",
  "transcription_error",
  "rejected",
]);

export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    url: text("url").notNull(),
    botName: text("bot_name"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    sourceProvider: text("source_provider"),
    sourceEventId: text("source_event_id"),
    organizerEmail: text("organizer_email"),
    participantEmails: jsonb("participant_emails").$type<string[]>(),
    status: meetingStatusEnum("status").default("pending").notNull(),
    errorMessage: text("error_message"),
    rawTranscription: text("raw_transcription"),
    summary: text("summary"),
    recordingFilePath: text("recording_file_path"),
    recordingStorageKey: text("recording_storage_key"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes").default(60),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Enforces (source_provider, source_event_id) uniqueness at the DB level so two
    // concurrent auto-join polls for the same calendar event can never both insert a
    // row — the arbiter for MeetingRepository.insertDedupedBySourceEvent's
    // ON CONFLICT DO NOTHING. Partial (WHERE source_event_id IS NOT NULL) because
    // manually-enqueued meetings carry null sourceEventId/sourceProvider and must stay
    // exempt. See spec/features/010-auto-join-dedup-and-recovery/spec.md Problem 1.
    uniqueIndex("meetings_source_event_unique_idx")
      .on(table.sourceProvider, table.sourceEventId)
      .where(sql`${table.sourceEventId} IS NOT NULL`),
  ],
).enableRLS();

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
}).enableRLS();

export const shareTypeEnum = pgEnum("share_type", ["restricted_email"]);

export const shareAccessResultEnum = pgEnum("share_access_result", [
  "granted",
  "denied",
  "expired",
  "revoked",
  "invalid",
]);

export const meetingShares = pgTable("meeting_shares", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  shareType: shareTypeEnum("share_type").notNull(),
  tokenHash: text("token_hash").notNull(),
  recipientEmail: text("recipient_email"),
  recipientEmailNormalized: text("recipient_email_normalized"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: text("created_by"),
  otpHash: text("otp_hash"),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  // Dies on first successful OTP verifyAccess() (013/ADR-0008) — verifyRestrictedAccess
  // revokes the share on first success by reusing revokedAt, same column the manual
  // revoke flow already sets.
  singleUse: boolean("single_use").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).enableRLS();

export const meetingShareAccessLogs = pgTable("meeting_share_access_logs", {
  id: text("id").primaryKey(),
  meetingShareId: text("meeting_share_id").notNull(),
  result: shareAccessResultEnum("result").notNull(),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull(),
}).enableRLS();

export const meetingAccessGrants = pgTable(
  "meeting_access_grants",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").notNull(),
    ownerId: text("owner_id").notNull(),
    granteeUserId: text("grantee_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Unconditional (NOT partial by revokedAt/expiresAt) — the idempotency contract is "at most
    // one grant row ever exists per (meetingId, granteeUserId) pair, full stop", matching
    // existsForMeetingAndGrantee's semantics (any row, revoked or not, counts as "already
    // handled"). Arbiter for MeetingAccessGrantRepository.createDedupedForMeetingAndGrantee's
    // ON CONFLICT DO NOTHING — same race class as meetings' source-event index (Problem 1),
    // one layer up. See spec/features/010-auto-join-dedup-and-recovery/spec.md Problem 2.
    uniqueIndex("meeting_access_grants_meeting_grantee_unique_idx").on(table.meetingId, table.granteeUserId),
  ],
).enableRLS();

export const shareRequestStatusEnum = pgEnum("share_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const shareRequestAccessTypeEnum = pgEnum("share_request_access_type", [
  "single_use",
  "temporary",
  "permanent",
]);

// A member Owner's proposed share (ADR-0008) — gates, never replaces, meetingAccessGrants /
// meetingShares. Approval re-enters those services on the Owner's behalf; rejection/cancellation
// create nothing here or downstream. One row per recipient.
export const meetingShareRequests = pgTable(
  "meeting_share_requests",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").notNull(),
    requesterId: text("requester_id").notNull(), // == meeting.ownerId at creation time
    granteeUserId: text("grantee_user_id"), // registered recipient (XOR the email pair below)
    recipientEmail: text("recipient_email"),
    recipientEmailNormalized: text("recipient_email_normalized"),
    accessType: shareRequestAccessTypeEnum("access_type").notNull(),
    expiresInDays: integer("expires_in_days"), // required iff accessType = "temporary"
    status: shareRequestStatusEnum("status").default("pending").notNull(),
    resolvedBy: text("resolved_by"), // admin users.id
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedGrantId: text("resolved_grant_id"),
    resolvedShareId: text("resolved_share_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    // Recipient is exactly one of a registered user or an unregistered email, enforced at the
    // DB level (mirrors meetingShares' recipientEmail/recipientEmailNormalized pairing).
    check(
      "meeting_share_requests_grantee_xor_email",
      sql`(${t.granteeUserId} IS NOT NULL) <> (${t.recipientEmailNormalized} IS NOT NULL)`,
    ),
    // Insert-is-the-arbiter idiom (same race class as meeting_access_grants_meeting_grantee_unique_idx
    // and meetings_source_event_unique_idx): partial unique per recipient kind so at most one pending
    // request exists per recipient — race-proof. Resolved requests (approved/rejected/cancelled)
    // don't collide, so a rejected request never blocks a later real one.
    uniqueIndex("msr_pending_grantee_uq")
      .on(t.meetingId, t.granteeUserId)
      .where(sql`${t.status} = 'pending' AND ${t.granteeUserId} IS NOT NULL`),
    uniqueIndex("msr_pending_email_uq")
      .on(t.meetingId, t.recipientEmailNormalized)
      .where(sql`${t.status} = 'pending' AND ${t.recipientEmailNormalized} IS NOT NULL`),
  ],
).enableRLS();

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("chat_messages_user_id_idx").on(t.userId, t.createdAt)],
).enableRLS();
