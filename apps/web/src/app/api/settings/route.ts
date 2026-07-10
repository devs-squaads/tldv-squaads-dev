import { NextRequest, NextResponse } from "next/server";
import { WebSettingsRepository } from "@/repositories/WebSettingsRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as Record<string, unknown>;
    await WebSettingsRepository.upsertMany(data);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown settings error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
