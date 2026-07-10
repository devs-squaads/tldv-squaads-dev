import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { createExtensionLinkToken, getRequestOrigin } from "@/services/extensionTokens";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const email = session?.user?.email;

  if (!userId || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = createExtensionLinkToken({
    userId,
    email,
    baseUrl: getRequestOrigin(request),
  });

  return NextResponse.json({
    linkToken: token.token,
    expiresAt: token.expiresAt,
    email,
  });
}
