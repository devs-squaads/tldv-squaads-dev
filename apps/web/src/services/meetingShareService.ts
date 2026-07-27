import { randomUUID } from "crypto";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { EmailProviderFactory } from "@/integrations/email/EmailProviderFactory";
import { SharingProviderFactory } from "@/integrations/sharing/SharingProviderFactory";
import { MeetingShareRepository } from "@/repositories/MeetingShareRepository";
import type { MeetingShareRecord } from "@/repositories/MeetingShareRepository";
import {
  buildShareAliasToken,
  generateShareToken,
  hashShareToken,
  hashValue,
  normalizeEmail,
  parseShareAliasToken,
} from "@/integrations/sharing/utils";
import type {
  CreateShareInput,
  PublicShareResolveResult,
  PublicSharedMeetingPayload,
  ShareCreationResult,
  ShareListItem,
  ShareStatus,
  ShareType,
} from "@/integrations/sharing/types";
import { StorageProviderFactory } from "@meeting-bot/shared/integrations/storage/StorageProviderFactory";
import { consumeRateLimit } from "@/integrations/sharing/rateLimit";
import { getConfiguredTtlOptionsMinutes, resolveExpiresAt } from "@/integrations/sharing/shareTtl";

interface AccessMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}

type VerifyRestrictedShareResult =
  | { status: "ok"; meeting: PublicSharedMeetingPayload }
  | { status: "denied" }
  | { status: "not_found" };

function parseIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getAppBaseUrl(): string {
  const fromEnv =
    process.env.SHARE_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL;

  return (fromEnv || "http://localhost:3000").replace(/\/+$/, "");
}

function getShareUrlFromParts(shareId: string, tokenHash: string): string {
  const aliasToken = buildShareAliasToken(shareId, tokenHash);
  return `${getAppBaseUrl()}/share/${aliasToken}`;
}

// 013/Phase 4.2 follow-up (PR3 fix): mirrors meetingAccessGrantService's
// resolveExpiresAtFromAccessType — direct Date math, does NOT call resolveExpiresAt(), so
// shareTtl.ts's fixed TTL-menu validation never runs for this path. Kept local (not extracted
// to a shared helper) to avoid touching meetingAccessGrantService.ts's already-committed code
// in this PR more than necessary; the two are structurally identical but independently owned.
// "single_use" throws here by design — it is resolved via the singleUse boolean field instead
// (see createShare below), never through accessType/expiresInDays.
function resolveExpiresAtFromAccessType(
  accessType: "single_use" | "temporary" | "permanent",
  expiresInDays?: number
): Date | null {
  if (accessType === "single_use") {
    throw new Error("single_use access is resolved via the singleUse field, not accessType/expiresInDays");
  }
  if (accessType === "permanent") {
    return null;
  }
  if (!expiresInDays || expiresInDays <= 0) {
    throw new Error("expiresInDays is required for temporary access");
  }
  return new Date(Date.now() + expiresInDays * 1440 * 60 * 1000);
}

function isShareActive(expiresAt: Date | null, revokedAt: Date | null, now: Date): boolean {
  return getShareStatus(expiresAt, revokedAt, now) === "active";
}

function getShareStatus(expiresAt: Date | null, revokedAt: Date | null, now: Date): ShareStatus {
  if (revokedAt) return "revoked";
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export class MeetingShareService {
  static getTtlOptionsMinutes(): number[] {
    return getConfiguredTtlOptionsMinutes();
  }

  private static async findShareByPublicToken(token: string): Promise<MeetingShareRecord | null> {
    const alias = parseShareAliasToken(token);
    if (alias) {
      const share = await MeetingShareRepository.findById(alias.shareId);
      if (!share) return null;
      return share.tokenHash.startsWith(alias.tokenHashPrefix) ? share : null;
    }

    return MeetingShareRepository.findByTokenHash(hashShareToken(token));
  }

  private static async logAccess(
    shareId: string,
    result: "granted" | "denied" | "expired" | "revoked" | "invalid",
    metadata?: AccessMetadata
  ): Promise<void> {
    await MeetingShareRepository.insertAccessLog({
      id: randomUUID(),
      meetingShareId: shareId,
      result,
      ipHash: metadata?.ipAddress ? hashValue(metadata.ipAddress) : null,
      userAgentHash: metadata?.userAgent ? hashValue(metadata.userAgent) : null,
      accessedAt: new Date(),
    });
  }

  private static async buildPublicMeetingPayload(meetingId: string): Promise<PublicSharedMeetingPayload | null> {
    const meeting = await MeetingRepository.findById(meetingId);
    if (!meeting) return null;

    let recordingUrl: string | null = null;
    if (meeting.recordingFilePath) {
      try {
        const storageKey = meeting.recordingStorageKey ?? buildRecordingStorageKey(meeting.id, meeting.url);
        const signedTtl = parseIntEnv("SHARE_SIGNED_URL_TTL_SECONDS", 900);
        const storage = StorageProviderFactory.getProvider();
        recordingUrl = await storage.getSignedUrl(storageKey, signedTtl, "inline");
      } catch (error) {
        console.warn("[MeetingShareService] Failed to sign recording URL:", error);
      }
    }

    return {
      id: meeting.id,
      title: meeting.botName || meeting.name || null,
      url: meeting.url,
      createdAt: meeting.createdAt,
      summary: meeting.summary,
      rawTranscription: meeting.rawTranscription,
      recordingUrl,
    };
  }

  // callerId is optional so the API_ROUTE_SECRET-gated M2M route
  // (/api/v1/shares, documented as session-independent) keeps working untouched;
  // every session-based caller (app/actions/shares.ts) always supplies it.
  // callerRole is optional and additive (013): a member Owner is routed to a Share Request
  // by the action layer, this guard defends non-action callers (e.g. the chat tool) from
  // bypassing approval; undefined role (M2M) is unaffected.
  static async createShare(
    input: CreateShareInput,
    callerId?: string,
    callerRole?: "admin" | "member"
  ): Promise<ShareCreationResult> {
    if (callerRole === "member") {
      throw new Error("Member owners must submit a share request for admin approval");
    }
    const meeting = await MeetingRepository.findById(input.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    if (callerId !== undefined && callerId !== meeting.ownerId) {
      throw new Error("Only the meeting owner can share this meeting");
    }
    if (meeting.status !== "completed") {
      throw new Error("Only completed meetings can be shared");
    }
    if ((input.shareType as string) === "public") {
      throw new Error("Public shares are no longer supported");
    }

    const shareType = input.shareType;
    const now = new Date();
    // accessType "temporary"/"permanent" bypasses the fixed ttlMinutes menu below (see
    // resolveExpiresAtFromAccessType); "single_use" and undefined fall through to the legacy
    // ttlMinutes/noExpiry path so the singleUse field stays the sole source of truth for
    // single-use shares (a real approval passes accessType: "single_use" alongside
    // noExpiry: true, and must not conflate the two mechanisms).
    const expiresAt =
      input.accessType && input.accessType !== "single_use"
        ? resolveExpiresAtFromAccessType(input.accessType, input.expiresInDays)
        : resolveExpiresAt(input.ttlMinutes, input.noExpiry);

    let recipientEmail: string | null = null;
    let recipientEmailNormalized: string | null = null;

    if (shareType === "restricted_email") {
      if (!input.recipientEmail?.trim()) {
        throw new Error("recipientEmail is required for restricted_email shares");
      }
      recipientEmail = input.recipientEmail.trim();
      recipientEmailNormalized = normalizeEmail(recipientEmail);
    }

    const token = generateShareToken();
    const shareId = randomUUID();
    const tokenHash = hashShareToken(token);

    await MeetingShareRepository.create({
      id: shareId,
      meetingId: input.meetingId,
      shareType,
      tokenHash,
      recipientEmail,
      recipientEmailNormalized,
      expiresAt,
      revokedAt: null,
      createdBy: input.createdBy ?? null,
      otpHash: null,
      otpExpiresAt: null,
      lastAccessedAt: null,
      singleUse: input.singleUse ?? false,
      createdAt: now,
      updatedAt: now,
    });

    const shareUrl = getShareUrlFromParts(shareId, tokenHash);
    if (shareType === "restricted_email" && recipientEmailNormalized) {
      await EmailProviderFactory.getProvider().send({
        to: recipientEmailNormalized,
        subject: "Invitacion a reunion compartida",
        text: `Has recibido acceso a una reunion compartida.\n\nEnlace: ${shareUrl}\n`,
      });
    }

    return {
      id: shareId,
      shareType,
      recipientEmail,
      expiresAt,
      shareUrl,
    };
  }

  static async listSharesByMeetingId(meetingId: string): Promise<ShareListItem[]> {
    const now = new Date();
    const records = await MeetingShareRepository.listByMeetingId(meetingId);
    return records.map((record) => ({
      id: record.id,
      meetingId: record.meetingId,
      shareType: record.shareType,
      status: getShareStatus(record.expiresAt, record.revokedAt, now),
      recipientEmail: record.recipientEmail,
      shareUrl: getShareUrlFromParts(record.id, record.tokenHash),
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      isActive: isShareActive(record.expiresAt, record.revokedAt, now),
    }));
  }

  // callerId is optional for the same M2M-route reason as createShare above.
  static async revokeShare(shareId: string, callerId?: string): Promise<void> {
    const share = await MeetingShareRepository.findById(shareId);
    if (!share) {
      throw new Error("Share not found");
    }
    if (callerId !== undefined) {
      const meeting = await MeetingRepository.findById(share.meetingId);
      if (!meeting || callerId !== meeting.ownerId) {
        throw new Error("Only the meeting owner can revoke this share");
      }
    }
    await MeetingShareRepository.revokeById(shareId, new Date());
  }

  // Owner-gated, mirrors revokeShare above. Only a revoked/expired share may be deleted — an
  // active one must be revoked first (deletion is for cleanup, revoke is for containment).
  static async deleteShare(shareId: string, callerId?: string): Promise<void> {
    const share = await MeetingShareRepository.findById(shareId);
    if (!share) {
      throw new Error("Share not found");
    }
    if (callerId !== undefined) {
      const meeting = await MeetingRepository.findById(share.meetingId);
      if (!meeting || callerId !== meeting.ownerId) {
        throw new Error("Only the meeting owner can delete this share");
      }
    }
    if (isShareActive(share.expiresAt, share.revokedAt, new Date())) {
      throw new Error("Only a revoked or expired share can be deleted");
    }
    await MeetingShareRepository.deleteById(shareId);
  }

  static async clearInactiveShares(meetingId: string): Promise<{ deletedCount: number }> {
    if (!meetingId) {
      throw new Error("meetingId is required");
    }

    const deletedCount = await MeetingShareRepository.deleteInactiveByMeetingId(meetingId, new Date());
    return { deletedCount };
  }

  static async renewShareAccess(
    shareId: string,
    options?: { ttlMinutes?: number; noExpiry?: boolean }
  ): Promise<{ shareUrl: string; expiresAt: Date | null }> {
    const share = await MeetingShareRepository.findById(shareId);
    if (!share) throw new Error("Share not found");
    if (share.revokedAt) {
      throw new Error("Revoked shares cannot be renewed");
    }
    if (!options || (!options.noExpiry && !options.ttlMinutes)) {
      throw new Error("ttlMinutes or noExpiry must be provided");
    }

    const expiresAt = resolveExpiresAt(options?.ttlMinutes, options?.noExpiry);
    const now = new Date();
    await MeetingShareRepository.updateById(share.id, {
      expiresAt,
      updatedAt: now,
    });

    return {
      shareUrl: getShareUrlFromParts(share.id, share.tokenHash),
      expiresAt,
    };
  }

  static async regenerateShareLink(shareId: string): Promise<{ shareUrl: string }> {
    const share = await MeetingShareRepository.findById(shareId);
    if (!share) throw new Error("Share not found");

    const token = generateShareToken();
    const tokenHash = hashShareToken(token);
    await MeetingShareRepository.rotateToken(share.id, tokenHash, new Date());

    const shareUrl = getShareUrlFromParts(share.id, tokenHash);
    if (share.shareType === "restricted_email") {
      if (!share.recipientEmailNormalized) {
        throw new Error("Share recipient email is missing");
      }

      await EmailProviderFactory.getProvider().send({
        to: share.recipientEmailNormalized,
        subject: "Nuevo enlace de acceso a reunion compartida",
        text: `Tu enlace de acceso actualizado:\n${shareUrl}\n`,
      });
    }

    return { shareUrl };
  }

  static async resolvePublicShare(token: string, metadata?: AccessMetadata): Promise<PublicShareResolveResult> {
    const share = await this.findShareByPublicToken(token);
    if (!share) {
      return { status: "not_found" };
    }

    const now = new Date();
    if (share.revokedAt) {
      await this.logAccess(share.id, "revoked", metadata);
      return { status: "not_found" };
    }
    if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) {
      await this.logAccess(share.id, "expired", metadata);
      return { status: "not_found" };
    }

    const provider = SharingProviderFactory.getProvider(share.shareType as ShareType);
    const decision = await provider.resolveAccess(share);
    if (!decision.authorized) {
      await this.logAccess(share.id, "denied", metadata);
      return { status: "requires_email_verification", shareType: "restricted_email" };
    }

    const payload = await this.buildPublicMeetingPayload(share.meetingId);
    if (!payload) {
      await this.logAccess(share.id, "invalid", metadata);
      return { status: "not_found" };
    }

    await MeetingShareRepository.markAccessed(share.id, now);
    await this.logAccess(share.id, "granted", metadata);

    return {
      status: "ok",
      shareType: share.shareType as ShareType,
      meeting: payload,
    };
  }

  static async requestRestrictedAccess(
    token: string,
    email: string,
    metadata?: AccessMetadata
  ): Promise<{ success: true }> {
    const share = await this.findShareByPublicToken(token);
    if (!share || share.shareType !== "restricted_email") {
      return { success: true };
    }

    const now = Date.now();
    if (share.revokedAt || (share.expiresAt && share.expiresAt.getTime() <= now)) {
      return { success: true };
    }

    const ipKey = metadata?.ipAddress || "unknown";
    const limit = parseIntEnv("SHARE_OTP_REQUEST_RATE_LIMIT", 5);
    const windowMs = parseIntEnv("SHARE_OTP_REQUEST_WINDOW_MS", 10 * 60 * 1000);
    const allowed = consumeRateLimit(`otp_req:${share.id}:${ipKey}`, limit, windowMs);
    if (!allowed) {
      throw new Error("Too many verification requests. Please try again later.");
    }

    const normalizedEmail = normalizeEmail(email);
    const provider = SharingProviderFactory.getProvider("restricted_email");
    await provider.requestAccess({
      share,
      token,
      normalizedEmail,
    });

    return { success: true };
  }

  static async verifyRestrictedAccess(
    token: string,
    email: string,
    code: string,
    metadata?: AccessMetadata
  ): Promise<VerifyRestrictedShareResult> {
    const share = await this.findShareByPublicToken(token);
    if (!share || share.shareType !== "restricted_email") {
      return { status: "not_found" };
    }

    const now = Date.now();
    if (share.revokedAt || (share.expiresAt && share.expiresAt.getTime() <= now)) {
      return { status: "not_found" };
    }

    const ipKey = metadata?.ipAddress || "unknown";
    const limit = parseIntEnv("SHARE_OTP_VERIFY_RATE_LIMIT", 10);
    const windowMs = parseIntEnv("SHARE_OTP_VERIFY_WINDOW_MS", 10 * 60 * 1000);
    const allowed = consumeRateLimit(`otp_verify:${share.id}:${ipKey}`, limit, windowMs);
    if (!allowed) {
      throw new Error("Too many verification attempts. Please try again later.");
    }

    const normalizedEmail = normalizeEmail(email);
    const provider = SharingProviderFactory.getProvider("restricted_email");
    const verified = await provider.verifyAccess({
      share,
      normalizedEmail,
      code,
    });

    if (!verified) {
      await this.logAccess(share.id, "denied", metadata);
      return { status: "denied" };
    }

    const payload = await this.buildPublicMeetingPayload(share.meetingId);
    if (!payload) {
      await this.logAccess(share.id, "invalid", metadata);
      return { status: "not_found" };
    }

    await MeetingShareRepository.markAccessed(share.id, new Date());
    await this.logAccess(share.id, "granted", metadata);

    // 013: singleUse dies on first successful verify — reuses revokedAt, same column the
    // manual revoke flow already sets, so a second attempt hits the revokedAt guard above.
    if (share.singleUse) {
      await MeetingShareRepository.revokeById(share.id, new Date());
    }

    return { status: "ok", meeting: payload };
  }
}
