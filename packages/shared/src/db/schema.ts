import { pgEnum, pgTable, text, integer, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";

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
  "rejected",
]);

export const meetings = pgTable("meetings", {
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
}).enableRLS();

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

export const meetingAccessGrants = pgTable("meeting_access_grants", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  ownerId: text("owner_id").notNull(),
  granteeUserId: text("grantee_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).enableRLS();

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
