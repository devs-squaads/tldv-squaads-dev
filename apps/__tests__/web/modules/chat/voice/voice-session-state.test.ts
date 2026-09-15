/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  createInitialVoiceSessionState,
  voiceSessionReducer,
} from "../../../../../web/src/modules/chat/voice/voiceSessionState";
import type { LiveServerEvent } from "../../../../../web/src/modules/chat/voice/liveEvents";

function applyEvents(
  state: ReturnType<typeof createInitialVoiceSessionState>,
  events: LiveServerEvent[],
) {
  return events.reduce(
    (current, event) => voiceSessionReducer(current, { type: "server-event", event }),
    state,
  );
}

describe("voiceSessionReducer", () => {
  it("arranca en idle escuchando", () => {
    expect(createInitialVoiceSessionState()).toEqual({
      status: "idle",
      activity: "listening",
      resumable: false,
      resumptionHandle: null,
      reconnectAttempts: 0,
      durationCapReached: false,
      endReason: null,
      errorMessage: null,
      goAwayTimeLeft: null,
    });
  });

  it("recorre idle → requesting-token → connecting → active", () => {
    let state = createInitialVoiceSessionState();
    state = voiceSessionReducer(state, { type: "start" });
    expect(state.status).toBe("requesting-token");

    state = voiceSessionReducer(state, { type: "token-acquired" });
    expect(state.status).toBe("connecting");

    state = voiceSessionReducer(state, { type: "socket-open" });
    expect(state.status).toBe("active");
    expect(state.activity).toBe("listening");
  });

  it("va a error si falla el minteo del token", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "start" });
    state = voiceSessionReducer(state, { type: "token-failed", message: "429" });

    expect(state.status).toBe("error");
    expect(state.errorMessage).toBe("429");
  });

  it("cambia a hablando con audio y transcripción de salida, y vuelve a escuchar con interrupted/turn-complete", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });

    state = applyEvents(state, [{ type: "audio", data: "x", mimeType: "audio/pcm;rate=24000" }]);
    expect(state.status).toBe("active");
    expect(state.activity).toBe("speaking");

    state = applyEvents(state, [{ type: "interrupted" }]);
    expect(state.activity).toBe("listening");

    state = applyEvents(state, [{ type: "output-transcript", text: "hola" }]);
    expect(state.activity).toBe("speaking");

    state = applyEvents(state, [{ type: "turn-complete" }]);
    expect(state.activity).toBe("listening");

    state = applyEvents(state, [{ type: "input-transcript", text: "che" }]);
    expect(state.activity).toBe("listening");
  });

  it("guarda el handle de sessionResumption y el goAway", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });

    state = applyEvents(state, [
      { type: "resumption-update", resumable: true, newHandle: "handle-1" },
      { type: "go-away", timeLeft: "10s" },
    ]);

    expect(state.resumable).toBe(true);
    expect(state.resumptionHandle).toBe("handle-1");
    expect(state.goAwayTimeLeft).toBe("10s");
    expect(state.status).toBe("active");
  });

  it("reconecta con token nuevo solo si hay handle resumible", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });
    state = applyEvents(state, [
      { type: "resumption-update", resumable: true, newHandle: "handle-1" },
    ]);

    state = voiceSessionReducer(state, { type: "connection-lost" });
    expect(state.status).toBe("reconnecting");
    expect(state.reconnectAttempts).toBe(1);

    state = voiceSessionReducer(state, { type: "socket-open" });
    expect(state.status).toBe("active");
  });

  it("no reconecta sin handle resumible: cierra la sesión", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });
    state = applyEvents(state, [{ type: "resumption-update", resumable: false }]);

    state = voiceSessionReducer(state, { type: "connection-lost" });

    expect(state.status).toBe("ended");
    expect(state.endReason).not.toBeNull();
  });

  it("termina en error tras dos reconexiones fallidas", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });
    state = applyEvents(state, [
      { type: "resumption-update", resumable: true, newHandle: "handle-1" },
    ]);

    state = voiceSessionReducer(state, { type: "connection-lost" });
    expect(state.status).toBe("reconnecting");

    state = voiceSessionReducer(state, { type: "reconnect-failed" });
    expect(state.status).toBe("reconnecting");
    expect(state.reconnectAttempts).toBe(2);

    state = voiceSessionReducer(state, { type: "reconnect-failed" });
    expect(state.status).toBe("error");
    expect(state.errorMessage).not.toBeNull();
  });

  it("cierra por tope de duración con aviso y no vuelve a reconectar", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });
    state = applyEvents(state, [
      { type: "resumption-update", resumable: true, newHandle: "handle-1" },
    ]);

    state = voiceSessionReducer(state, { type: "duration-cap-reached" });
    expect(state.status).toBe("ended");
    expect(state.durationCapReached).toBe(true);
    expect(state.endReason).toContain("duración");

    // Aunque llegue una caída de conexión después, el tope manda: no se reconecta.
    state = voiceSessionReducer(state, { type: "connection-lost" });
    expect(state.status).toBe("ended");
  });

  it("cierra la sesión cuando el usuario la detiene", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "socket-open" });
    state = voiceSessionReducer(state, { type: "stop" });

    expect(state.status).toBe("ended");
    expect(state.endReason).not.toBeNull();
  });

  it("ignora eventos de audio/transcripción fuera de una sesión activa", () => {
    const state = applyEvents(createInitialVoiceSessionState(), [
      { type: "audio", data: "x", mimeType: "audio/pcm;rate=24000" },
      { type: "turn-complete" },
    ]);

    expect(state).toEqual(createInitialVoiceSessionState());
  });

  it("permite reiniciar tras terminar", () => {
    let state = voiceSessionReducer(createInitialVoiceSessionState(), { type: "stop" });
    state = voiceSessionReducer(state, { type: "reset" });

    expect(state).toEqual(createInitialVoiceSessionState());
  });
});
