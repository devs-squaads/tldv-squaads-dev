import { NextRequest, NextResponse } from "next/server";
import { assertPrivateApiAuthorized } from "@/services/privateApiAuth";
import {
  getTranscriptionSettings,
  saveTranscriptionSettings,
} from "@meeting-bot/shared/services/transcriptionSettings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = assertPrivateApiAuthorized(req);
  if (unauthorized) return unauthorized;

  const settings = await getTranscriptionSettings();
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const unauthorized = assertPrivateApiAuthorized(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as { context?: unknown; dictionary?: unknown };
    const settings = await saveTranscriptionSettings(body);
    return NextResponse.json(settings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown transcription settings error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
