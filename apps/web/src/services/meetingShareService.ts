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
        const storageKey = buildRecordingStorageKey(meeting.id, meeting.url);
        const signedTtl = parseIntEnv("SHARE_SIGNED_URL_TTL_SECONDS", 900);
        const storage = StorageProviderFactory.getProvider();
        recordingUrl = await storage.getSignedUrl(storageKey, signedTtl);
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

  static async createShare(input: CreateShareInput): Promise<ShareCreationResult> {
    const meeting = await MeetingRepository.findById(input.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    if (meeting.status !== "completed") {
      throw new Error("Only completed meetings can be shared");
    }

    const shareType = input.shareType;
    const now = new Date();
    const expiresAt = resolveExpiresAt(input.ttlMinutes, input.noExpiry);

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

  static async revokeShare(shareId: string): Promise<void> {
    const share = await MeetingShareRepository.findById(shareId);
    if (!share) {
      throw new Error("Share not found");
    }
    await MeetingShareRepository.revokeById(shareId, new Date());
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
    return { status: "ok", meeting: payload };
  }
}
