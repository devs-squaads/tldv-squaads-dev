import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import {
  getTranscriptionSettings,
  saveTranscriptionSettings,
} from "@meeting-bot/shared/services/transcriptionSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const settings = await getTranscriptionSettings();
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { context?: unknown; dictionary?: unknown };
    const settings = await saveTranscriptionSettings(body);
    return NextResponse.json(settings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown transcription settings error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
