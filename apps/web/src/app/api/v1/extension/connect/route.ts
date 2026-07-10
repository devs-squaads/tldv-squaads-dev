import { NextRequest, NextResponse } from "next/server";
import {
  createExtensionAccessToken,
  getRequestOrigin,
  readExtensionLinkToken,
} from "@/services/extensionTokens";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const linkToken = typeof body.linkToken === "string" ? body.linkToken.trim() : "";

    if (!linkToken) {
      return NextResponse.json({ error: "linkToken is required" }, { status: 400 });
    }

    const payload = readExtensionLinkToken(linkToken);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired link token" }, { status: 401 });
    }

    if (payload.baseUrl !== getRequestOrigin(request)) {
      return NextResponse.json({ error: "Link token origin mismatch" }, { status: 403 });
    }

    const accessToken = createExtensionAccessToken({
      userId: payload.userId,
      email: payload.email,
      baseUrl: payload.baseUrl,
    });

    return NextResponse.json({
      apiBaseUrl: payload.baseUrl,
      linkedAccountEmail: payload.email,
      extensionAccessToken: accessToken.token,
      expiresAt: accessToken.expiresAt,
    });
  } catch {
    return NextResponse.json({ error: "Failed to connect extension" }, { status: 500 });
  }
}
