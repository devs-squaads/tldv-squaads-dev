import { createHash, randomBytes, timingSafeEqual } from "crypto";

const SHARE_ALIAS_PREFIX = "s";
const SHARE_ALIAS_HASH_PREFIX_LENGTH = 24;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashShareToken(token: string): string {
  return hashValue(token);
}

export function buildShareAliasToken(shareId: string, tokenHash: string): string {
  const prefix = tokenHash.slice(0, SHARE_ALIAS_HASH_PREFIX_LENGTH);
  return `${SHARE_ALIAS_PREFIX}.${shareId}.${prefix}`;
}

export function parseShareAliasToken(token: string): { shareId: string; tokenHashPrefix: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  if (parts[0] !== SHARE_ALIAS_PREFIX) return null;

  const shareId = parts[1];
  const tokenHashPrefix = parts[2];
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shareId);
  if (!isUuid) return null;

  const isValidPrefix = /^[0-9a-f]+$/i.test(tokenHashPrefix) && tokenHashPrefix.length === SHARE_ALIAS_HASH_PREFIX_LENGTH;
  if (!isValidPrefix) return null;

  return { shareId, tokenHashPrefix: tokenHashPrefix.toLowerCase() };
}

export function generateNumericOtp(length: number): string {
  const size = Number.isFinite(length) && length > 0 ? Math.floor(length) : 6;
  let out = "";
  for (let i = 0; i < size; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

export function hashOtp(shareId: string, otpCode: string): string {
  return hashValue(`${shareId}:${otpCode}`);
}

export function secureCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
