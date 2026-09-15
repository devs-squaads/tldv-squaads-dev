/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  LIVE_AUDIO_MIME_TYPE,
  buildConversationAudioMessage,
  buildConversationSetupMessage,
  buildConversationTurnCompleteMessage,
  buildToolResponseMessage,
  buildTranscriptionAudioMessage,
  buildTranscriptionSetupMessage,
  buildTranscriptionStreamEndMessage,
} from "../../../../../web/src/modules/chat/voice/liveClientMessages";

describe("setup del socket de conversación", () => {
  it("en la primera conexión aporta contextWindowCompression (no va en el token)", () => {
    expect(buildConversationSetupMessage()).toEqual({
      setup: { contextWindowCompression: { slidingWindow: {} } },
    });
  });

  it("en la reconexión suma el handle de sessionResumption", () => {
    expect(buildConversationSetupMessage("handle-1")).toEqual({
      setup: {
        sessionResumption: { handle: "handle-1" },
        contextWindowCompression: { slidingWindow: {} },
      },
    });
  });
});

describe("setup del socket de transcripción", () => {
  it("va vacío: no necesita resumption ni compresión", () => {
    expect(buildTranscriptionSetupMessage()).toEqual({ setup: {} });
  });
});

describe("audio de conversación (gemini-3.8-live)", () => {
  it("va por clientContent con inlineData, NUNCA por realtimeInput", () => {
    const message = buildConversationAudioMessage("QUJD");

    expect(message).toEqual({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: LIVE_AUDIO_MIME_TYPE, data: "QUJD" } }],
          },
        ],
      },
    });
    expect(message).not.toHaveProperty("realtimeInput");
  });

  it("el cierre de turno es clientContent.turnComplete, no audioStreamEnd", () => {
    const message = buildConversationTurnCompleteMessage();

    expect(message).toEqual({ clientContent: { turnComplete: true } });
    expect(message).not.toHaveProperty("realtimeInput");
  });
});

describe("audio de transcripción (gemini-3.5-transcribe-live)", () => {
  it("va por realtimeInput.audio", () => {
    expect(buildTranscriptionAudioMessage("QUJD")).toEqual({
      realtimeInput: {
        audio: { data: "QUJD", mimeType: LIVE_AUDIO_MIME_TYPE },
      },
    });
  });

  it("cierra el stream con realtimeInput.audioStreamEnd", () => {
    expect(buildTranscriptionStreamEndMessage()).toEqual({
      realtimeInput: { audioStreamEnd: true },
    });
  });
});

describe("buildToolResponseMessage", () => {
  it("usa la forma verificada toolResponse.functionResponses", () => {
    const message = buildToolResponseMessage([
      { id: "call-1", name: "search_meetings", response: { result: [] } },
    ]);

    expect(message).toEqual({
      toolResponse: {
        functionResponses: [{ id: "call-1", name: "search_meetings", response: { result: [] } }],
      },
    });
  });
});
