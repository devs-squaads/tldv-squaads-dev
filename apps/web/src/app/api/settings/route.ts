import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { WebSettingsRepository } from "@/repositories/WebSettingsRepository";
import { partitionSettingWrites } from "@/lib/apiAuthGuards";

export const dynamic = "force-dynamic";

/**
 * Endpoint genérico de settings de la UI (spec 015).
 *
 * Dos barreras, no una:
 *  1. Session Auth — antes era anónimo, así que cualquiera en internet podía escribir en la tabla
 *     `settings` (que aloja `transcription_context` y `transcription_dictionary`, inyectados en el
 *     prompt de ASR y del refiner: inyección de prompt persistente sobre todas las reuniones).
 *  2. Allowlist de claves — la UI sólo escribe `monitor_email` por aquí; el contexto IA tiene su
 *     propia ruta. Sin allowlist, una sesión cualquiera seguía pudiendo reescribir claves globales.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
    if (!sessionUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = (await req.json()) as Record<string, unknown>;
    const { accepted, rejected } = partitionSettingWrites(data);

    if (rejected.length > 0) {
      return NextResponse.json(
        {
          error: `Claves no editables por este endpoint: ${rejected.join(", ")}`,
          rejected,
        },
        { status: 400 },
      );
    }

    if (Object.keys(accepted).length > 0) {
      await WebSettingsRepository.upsertMany(accepted);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown settings error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
