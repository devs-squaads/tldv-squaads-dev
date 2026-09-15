import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { resolveVoicePolicy } from "@/modules/chat/voice/voicePolicy";

export const dynamic = "force-dynamic";

/** GET /api/chat/voice/config — qué puede mostrar y usar el cliente de voz. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const policy = resolveVoicePolicy();

  return NextResponse.json({
    enabled: policy.enabled,
    model: policy.model,
    maxSessionMinutes: policy.maxSessionMinutes,
  });
}
