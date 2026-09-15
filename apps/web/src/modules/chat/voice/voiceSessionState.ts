/**
 * Máquina de estados de la sesión de voz.
 *
 * Reducer puro sobre los eventos normalizados de `liveEvents` más las acciones
 * locales del transporte. Guardas verificadas:
 *  - no reconectar si la sesión no reportó ser resumible (no hay handle);
 *  - no reconectar después de cerrar por tope de duración;
 *  - error terminal tras dos reconexiones fallidas.
 */

import type { LiveServerEvent } from "@/modules/chat/voice/liveEvents";

export type VoiceSessionStatus =
  | "idle"
  | "requesting-token"
  | "connecting"
  | "active"
  | "reconnecting"
  | "ended"
  | "error";

export type VoiceActivity = "listening" | "speaking";

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  activity: VoiceActivity;
  resumable: boolean;
  resumptionHandle: string | null;
  reconnectAttempts: number;
  durationCapReached: boolean;
  endReason: string | null;
  errorMessage: string | null;
  goAwayTimeLeft: string | null;
}

export type VoiceSessionAction =
  | { type: "start" }
  | { type: "token-acquired" }
  | { type: "token-failed"; message: string }
  | { type: "socket-open" }
  | { type: "server-event"; event: LiveServerEvent }
  | { type: "connection-lost" }
  | { type: "reconnect-failed" }
  | { type: "duration-cap-reached" }
  | { type: "stop" }
  | { type: "reset" };

export const MAX_VOICE_RECONNECT_ATTEMPTS = 2;

const DURATION_CAP_REASON = "Se alcanzó el tope de duración configurado para la sesión de voz";
const USER_STOP_REASON = "El usuario detuvo la sesión de voz";
const NOT_RESUMABLE_REASON = "Se perdió la conexión y la sesión de voz no era resumible";
const RECONNECT_FAILED_REASON =
  "No se pudo restablecer la sesión de voz después de dos intentos de reconexión";

export function createInitialVoiceSessionState(): VoiceSessionState {
  return {
    status: "idle",
    activity: "listening",
    resumable: false,
    resumptionHandle: null,
    reconnectAttempts: 0,
    durationCapReached: false,
    endReason: null,
    errorMessage: null,
    goAwayTimeLeft: null,
  };
}

function applyServerEvent(
  state: VoiceSessionState,
  event: LiveServerEvent,
): VoiceSessionState {
  switch (event.type) {
    case "resumption-update":
      return {
        ...state,
        resumable: event.resumable,
        resumptionHandle: event.newHandle ?? state.resumptionHandle,
      };
    case "go-away":
      return { ...state, goAwayTimeLeft: event.timeLeft ?? state.goAwayTimeLeft };
    default:
      break;
  }

  if (state.status !== "active") return state;

  switch (event.type) {
    case "setup-complete":
      return state;
    case "audio":
    case "output-transcript":
      return { ...state, activity: "speaking" };
    case "input-transcript":
    case "interrupted":
    case "turn-complete":
      return { ...state, activity: "listening" };
    case "tool-call":
      return { ...state, activity: "speaking" };
    case "tool-cancellation":
      return state;
    case "error":
      return { ...state, status: "error", errorMessage: event.message };
    case "unknown":
    default:
      return state;
  }
}

export function voiceSessionReducer(
  state: VoiceSessionState,
  action: VoiceSessionAction,
): VoiceSessionState {
  switch (action.type) {
    case "reset":
      return createInitialVoiceSessionState();

    case "start":
      return {
        ...createInitialVoiceSessionState(),
        status: "requesting-token",
      };

    case "token-acquired":
      return state.status === "requesting-token" ? { ...state, status: "connecting" } : state;

    case "token-failed":
      return { ...state, status: "error", errorMessage: action.message };

    case "socket-open":
      return { ...state, status: "active", activity: "listening", reconnectAttempts: 0 };

    case "server-event":
      return applyServerEvent(state, action.event);

    case "connection-lost": {
      if (state.status === "idle" || state.status === "ended" || state.status === "error") {
        return state;
      }
      if (state.durationCapReached) return state;

      if (state.resumable && state.resumptionHandle) {
        return {
          ...state,
          status: "reconnecting",
          activity: "listening",
          reconnectAttempts: state.reconnectAttempts + 1,
        };
      }

      return { ...state, status: "ended", activity: "listening", endReason: NOT_RESUMABLE_REASON };
    }

    case "reconnect-failed": {
      if (state.status !== "reconnecting") return state;

      if (state.reconnectAttempts >= MAX_VOICE_RECONNECT_ATTEMPTS) {
        return { ...state, status: "error", errorMessage: RECONNECT_FAILED_REASON };
      }

      return { ...state, reconnectAttempts: state.reconnectAttempts + 1 };
    }

    case "duration-cap-reached":
      return {
        ...state,
        status: "ended",
        activity: "listening",
        durationCapReached: true,
        endReason: DURATION_CAP_REASON,
      };

    case "stop":
      return { ...state, status: "ended", activity: "listening", endReason: USER_STOP_REASON };

    default:
      return state;
  }
}
