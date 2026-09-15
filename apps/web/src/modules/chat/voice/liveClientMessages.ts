/**
 * Constructores de mensajes cliente → Gemini Live.
 *
 * Módulo puro: fija las formas **verificadas contra la API real**, que no son
 * las que publica la doc:
 *  - la conversación manda audio por `clientContent` (con `inlineData`) y cierra
 *    el turno con `{ clientContent: { turnComplete: true } }`;
 *    `realtimeInput.audio` se ignora en silencio en `gemini-3.8-live`;
 *  - la transcripción de la voz del usuario manda audio por
 *    `realtimeInput.audio` en un socket aparte y cierra con `audioStreamEnd`.
 */

/** PCM mono 16 kHz little-endian, en base64. */
export const LIVE_AUDIO_MIME_TYPE = "audio/pcm;rate=16000";

export interface LiveClientTurn {
  role: "user";
  parts: Array<{ inlineData: { mimeType: string; data: string } }>;
}

export interface LiveFunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

export type LiveClientMessage =
  | {
      setup: {
        sessionResumption?: { handle: string };
        contextWindowCompression?: { slidingWindow: Record<string, unknown> };
      };
    }
  | { clientContent: { turns: LiveClientTurn[] } }
  | { clientContent: { turnComplete: true } }
  | { realtimeInput: { audio: { data: string; mimeType: string } } }
  | { realtimeInput: { audioStreamEnd: true } }
  | { realtimeInput: { text: string } }
  | { toolResponse: { functionResponses: LiveFunctionResponse[] } };

/**
 * Setup del socket de conversación. El `contextWindowCompression` lo aporta el
 * cliente (no va fijado en el token) y el handle solo existe al reconectar.
 */
export function buildConversationSetupMessage(handle?: string): LiveClientMessage {
  return {
    setup: {
      ...(handle ? { sessionResumption: { handle } } : {}),
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

/** Setup del socket de transcripción: no necesita resumption ni compresión. */
export function buildTranscriptionSetupMessage(): LiveClientMessage {
  return { setup: {} };
}

/** Chunk de voz del usuario en el socket de conversación (`clientContent`). */
export function buildConversationAudioMessage(base64: string): LiveClientMessage {
  return {
    clientContent: {
      turns: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: LIVE_AUDIO_MIME_TYPE, data: base64 } }],
        },
      ],
    },
  };
}

/** El cliente decide cuándo terminó de hablar el usuario. */
export function buildConversationTurnCompleteMessage(): LiveClientMessage {
  return { clientContent: { turnComplete: true } };
}

/** Chunk de voz del usuario en el socket de transcripción (`realtimeInput`). */
export function buildTranscriptionAudioMessage(base64: string): LiveClientMessage {
  return {
    realtimeInput: {
      audio: { data: base64, mimeType: LIVE_AUDIO_MIME_TYPE },
    },
  };
}

/** Cierre del stream de audio del socket de transcripción (no hay `turnComplete`). */
export function buildTranscriptionStreamEndMessage(): LiveClientMessage {
  return { realtimeInput: { audioStreamEnd: true } };
}

export function buildToolResponseMessage(
  functionResponses: LiveFunctionResponse[],
): LiveClientMessage {
  return { toolResponse: { functionResponses } };
}
