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
} from "@/modules/chat/voice/liveTokenRequest";
import { resolveVoicePolicy } from "@/modules/chat/voice/voicePolicy";

export const dynamic = "force-dynamic";

const AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GOOGLE_ERROR_MESSAGE =
  "No se pudo iniciar la sesión de voz. Intentá de nuevo en unos minutos.";

/**
 * POST /api/chat/voice/token
 *
 * Mintea un token efímero de un solo uso con la configuración, la
 * `systemInstruction` y las tools **fijadas en el token**: el navegador solo
 * abre la sesión con `setup: {}` y la API key nunca sale del servidor.
 *
 * Por voz solo viajan `READ_ONLY_TOOLS`: una instrucción hablada mal transcrita
 * no debe ejecutar una mutación.
 */
export async function POST() {
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

  try {
    const persistedHistory = await ChatMessageRepository.findByUserId(session.user.id);
    const userContext = await buildUserContext({
      userId: session.user.id,
      role: session.user.role,
    });
    const promptAssembly = assembleChatSystemPrompt({
      messages: persistedHistory,
      userContext,
      topK: 4,
      channel: "voice",
    });

    const setup = buildLiveConnectConstraints({
      model: policy.model,
      systemInstruction: promptAssembly.systemContent,
      tools: READ_ONLY_TOOLS,
    });

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
      model: policy.model,
      expiresAt: token.expireTime ?? requestBody.expireTime,
    });
  } catch {
    return NextResponse.json({ error: GOOGLE_ERROR_MESSAGE }, { status: 502 });
  }
}
