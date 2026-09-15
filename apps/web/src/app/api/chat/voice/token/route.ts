import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { assembleChatSystemPrompt } from "@/integrations/chat/knowledge/promptAssembler";
import { buildUserContext } from "@/integrations/chat/knowledge/userContext";
import { READ_ONLY_TOOLS } from "@/integrations/chat/tools";
import { consumeRateLimit } from "@/integrations/sharing/rateLimit";
import { ChatMessageRepository } from "@/repositories/ChatMessageRepository";
import {
  buildAuthTokenRequestBody,
  buildLiveConnectConstraints,
  parseAuthTokenResponse,
  type LiveTokenPurpose,
} from "@/modules/chat/voice/liveTokenRequest";
import { resolveVoicePolicy } from "@/modules/chat/voice/voicePolicy";

export const dynamic = "force-dynamic";

const AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GOOGLE_ERROR_MESSAGE =
  "No se pudo iniciar la sesión de voz. Intentá de nuevo en unos minutos.";

function parsePurpose(body: unknown): LiveTokenPurpose | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "conversation";
  }

  const rawPurpose = (body as Record<string, unknown>).purpose;
  if (rawPurpose === undefined) return "conversation";
  return rawPurpose === "conversation" || rawPurpose === "transcription" ? rawPurpose : null;
}

/**
 * POST /api/chat/voice/token
 *
 * Mintea un token efímero de un solo uso con la configuración **fijada en el
 * token**: el navegador solo abre la sesión con `setup: {}` y la API key nunca
 * sale del servidor.
 *
 * Hay dos propósitos, un token por socket:
 *  - `conversation` (default): `gemini-3.8-live` con prompt, `READ_ONLY_TOOLS` y
 *    `responseModalities: ["AUDIO"]`;
 *  - `transcription`: `gemini-3.5-transcribe-live` con `responseModalities:
 *    ["TEXT"]` e `inputAudioTranscription`, sin prompt ni tools, para transcribir
 *    la voz del usuario (el socket de conversación no la entrega).
 *
 * El rate limit se consume **una vez por sesión**: solo el token de conversación.
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

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "La voz en tiempo real no está configurada en este servidor." },
      { status: 503 },
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const purpose = parsePurpose(body);
  if (!purpose) {
    return NextResponse.json(
      { error: "purpose inválido: se espera conversation o transcription." },
      { status: 400 },
    );
  }

  // Una sesión de voz = un token de conversación + uno de transcripción.
  // El cupo se consume una sola vez, con el de conversación.
  if (purpose === "conversation") {
    const withinQuota = consumeRateLimit(
      `voice-token:${session.user.id}`,
      policy.rateLimit.limit,
      policy.rateLimit.windowMs,
    );
    if (!withinQuota) {
      return NextResponse.json(
        { error: "Alcanzaste el límite de sesiones de voz. Esperá un minuto e intentá de nuevo." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(policy.rateLimit.windowMs / 1000)),
          },
        },
      );
    }
  }

  try {
    const setup =
      purpose === "conversation"
        ? await buildConversationSetup(session.user.id, session.user.role, policy.model)
        : buildLiveConnectConstraints({
            purpose: "transcription",
            model: policy.transcribeModel,
          });

    const model = purpose === "conversation" ? policy.model : policy.transcribeModel;
    const tokenLifetimeMs = (policy.maxSessionMinutes + 5) * 60_000;
    const requestBody = buildAuthTokenRequestBody({ setup, tokenLifetimeMs });

    const googleResponse = await fetch(AUTH_TOKENS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!googleResponse.ok) {
      return NextResponse.json({ error: GOOGLE_ERROR_MESSAGE }, { status: 502 });
    }

    const payload = await googleResponse.json().catch(() => null);

    let token;
    try {
      token = parseAuthTokenResponse(payload);
    } catch {
      return NextResponse.json({ error: GOOGLE_ERROR_MESSAGE }, { status: 502 });
    }

    return NextResponse.json({
      token: token.name,
      model,
      expiresAt: token.expireTime ?? requestBody.expireTime,
    });
  } catch {
    return NextResponse.json({ error: GOOGLE_ERROR_MESSAGE }, { status: 502 });
  }
}

async function buildConversationSetup(
  userId: string,
  role: Parameters<typeof buildUserContext>[0]["role"],
  model: string,
) {
  const persistedHistory = await ChatMessageRepository.findByUserId(userId);
  const userContext = await buildUserContext({ userId, role });
  const promptAssembly = assembleChatSystemPrompt({
    messages: persistedHistory,
    userContext,
    topK: 4,
    channel: "voice",
  });

  return buildLiveConnectConstraints({
    purpose: "conversation",
    model,
    systemInstruction: promptAssembly.systemContent,
    tools: READ_ONLY_TOOLS,
  });
}
