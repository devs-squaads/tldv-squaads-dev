import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

type ExtensionTokenType = "extension_link" | "extension_access";

interface BaseExtensionTokenPayload {
  type: ExtensionTokenType;
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface ExtensionLinkTokenPayload extends BaseExtensionTokenPayload {
  type: "extension_link";
  baseUrl: string;
}

export interface ExtensionAccessTokenPayload extends BaseExtensionTokenPayload {
  type: "extension_access";
  baseUrl: string;
}

export function normalizeOriginString(input: string): string {
  try {
    const parsed = new URL(input.trim());
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port;
    const isDefaultPort =
      (protocol === "https:" && port === "443") ||
      (protocol === "http:" && port === "80");
    const host = port && !isDefaultPort ? `${hostname}:${port}` : hostname;

    return `${protocol}//${host}`;
  } catch {
    return "";
  }
}

function getExtensionTokenSecret(): string {
  return `${process.env.NEXTAUTH_SECRET || process.env.API_ROUTE_SECRET || "squaads-dev-secret-change-in-production"}:extension-v1`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSegment(segment: string): string {
  return createHmac("sha256", getExtensionTokenSecret()).update(segment).digest("base64url");
}

function serializeToken<T extends BaseExtensionTokenPayload>(payload: T): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signSegment(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseToken<T extends BaseExtensionTokenPayload>(token: string, expectedType: T["type"]): T | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signSegment(encodedPayload);
  if (signature.length !== expectedSignature.length) return null;
  const isValidSignature = timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  if (!isValidSignature) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as T;
    if (payload.type !== expectedType) return null;
    if (!payload.exp || payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createExtensionLinkToken(input: {
  userId: string;
  email: string;
  baseUrl: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } {
  const ttlSeconds = input.ttlSeconds ?? 10 * 60;
  const now = Math.floor(Date.now() / 1000);
  const payload: ExtensionLinkTokenPayload = {
    type: "extension_link",
    userId: input.userId,
    email: input.email,
    baseUrl: normalizeOriginString(input.baseUrl),
    iat: now,
    exp: now + ttlSeconds,
  };

  return {
    token: serializeToken(payload),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function readExtensionLinkToken(token: string): ExtensionLinkTokenPayload | null {
  return parseToken<ExtensionLinkTokenPayload>(token, "extension_link");
}

export function createExtensionAccessToken(input: {
  userId: string;
  email: string;
  baseUrl: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } {
  const ttlSeconds = input.ttlSeconds ?? 30 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const payload: ExtensionAccessTokenPayload = {
    type: "extension_access",
    userId: input.userId,
    email: input.email,
    baseUrl: normalizeOriginString(input.baseUrl),
    iat: now,
    exp: now + ttlSeconds,
  };

  return {
    token: serializeToken(payload),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function readExtensionAccessToken(token: string): ExtensionAccessTokenPayload | null {
  return parseToken<ExtensionAccessTokenPayload>(token, "extension_access");
}

export function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "http";
  const candidateHost = forwardedHost || host;

  if (candidateHost) {
    return normalizeOriginString(`${protocol}://${candidateHost}`);
  }

  return normalizeOriginString(request.nextUrl.origin);
}

export function assertExtensionAccessAuthorized(request: NextRequest):
  | { ok: true; payload: ExtensionAccessTokenPayload }
  | { ok: false; response: NextResponse } {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing extension access token" }, { status: 401 }),
    };
  }

  const payload = readExtensionAccessToken(token);
  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or expired extension access token" }, { status: 401 }),
    };
  }

  if (payload.baseUrl !== getRequestOrigin(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Token origin mismatch" }, { status: 403 }),
    };
  }

  return { ok: true, payload };
}
