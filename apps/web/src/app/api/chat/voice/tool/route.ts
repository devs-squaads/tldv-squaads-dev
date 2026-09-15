import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { READ_ONLY_TOOLS } from "@/integrations/chat/tools";
import { resolveVoicePolicy } from "@/modules/chat/voice/voicePolicy";

export const dynamic = "force-dynamic";

const TOOL_ERROR_MESSAGE = "No se pudo ejecutar la herramienta solicitada.";

/**
 * POST /api/chat/voice/tool
 *
 * Puente de tools de la voz: el `toolCall` llega al **browser** por el
 * WebSocket, pero las tools viven en el servidor (usan `getServerSession`). El
 * cliente reenvía la llamada acá y devuelve el resultado por el WebSocket con
 * `{ toolResponse: { functionResponses: [...] } }`.
 *
 * Solo se pueden ejecutar tools de `READ_ONLY_TOOLS`: cualquier otro nombre
 * responde 403 **sin ejecutar nada**.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const policy = resolveVoicePolicy();
  if (!policy.enabled) {
    return NextResponse.json(
      { error: "La voz en tiempo real está deshabilitada." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Falta el nombre de la herramienta." }, { status: 400 });
  }

  const tool = READ_ONLY_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    return NextResponse.json(
      { error: "La herramienta solicitada no está permitida por voz." },
      { status: 403 },
    );
  }

  const args =
    typeof record.args === "object" && record.args !== null && !Array.isArray(record.args)
      ? (record.args as Record<string, unknown>)
      : {};

  try {
    const result = await tool.execute(args);
    return NextResponse.json({ result });
  } catch {
    // Nunca filtrar el error interno al cliente de voz.
    return NextResponse.json({ error: TOOL_ERROR_MESSAGE }, { status: 500 });
  }
}
