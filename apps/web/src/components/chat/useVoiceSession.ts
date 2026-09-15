"use client";

/**
 * useVoiceSession — transporte de la voz en tiempo real (protocolo corregido).
 *
 * Dos sockets en paralelo, cada uno con su token efímero restringido:
 *  - **conversación** (`gemini-3.8-live`): recibe la voz del usuario por
 *    `clientContent` con `inlineData` (`realtimeInput.audio` se ignora en
 *    silencio en ese modelo) y cierra el turno con
 *    `{ clientContent: { turnComplete: true } }`. Devuelve audio +
 *    `outputTranscription` + `toolCall`.
 *  - **transcripción** (`gemini-3.5-transcribe-live`): recibe la voz por
 *    `realtimeInput.audio`, cierra con `audioStreamEnd` y emite
 *    `inputTranscription` (el socket de conversación no la entrega). **No** manda
 *    `turnComplete`: no se espera.
 *
 * El primer mensaje de cada socket es `{ setup: {} }`; la config viene fijada en
 * el token. Al reconectar se mintea un token **nuevo** (reusar da 1011) y se abre
 * con `{ setup: { sessionResumption: { handle } } }`.
 *
 * Toda la lógica de decisión vive en módulos puros (`liveEvents`,
 * `liveClientMessages`, `voiceSessionState`, `pcm`); acá solo hay efectos de
 * navegador y red.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  mergeTranscriptText,
  type VoiceTranscriptTurn,
} from "@/components/chat/voiceWidget.logic";
import {
  buildConversationAudioMessage,
  buildConversationSetupMessage,
  buildConversationTurnCompleteMessage,
  buildToolResponseMessage,
  buildTranscriptionAudioMessage,
  buildTranscriptionSetupMessage,
  buildTranscriptionStreamEndMessage,
  type LiveFunctionResponse,
} from "@/modules/chat/voice/liveClientMessages";
import {
  normalizeLiveServerMessage,
  type LiveFunctionCall,
  type LiveServerEvent,
} from "@/modules/chat/voice/liveEvents";
import type { LiveTokenPurpose } from "@/modules/chat/voice/liveTokenRequest";
import {
  base64ToPcm16,
  downsampleTo16k,
  float32ToPcm16,
  pcm16ToBase64,
  pcm16ToFloat32,
} from "@/modules/chat/voice/pcm";
import {
  createInitialVoiceSessionState,
  voiceSessionReducer,
  type VoiceActivity,
  type VoiceSessionStatus,
} from "@/modules/chat/voice/voiceSessionState";

/** Endpoint verificado contra la API real (BidiGenerateContentConstrained). */
const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const CAPTURE_WORKLET_URL = "/worklets/pcm-capture.js";
const PLAYBACK_WORKLET_URL = "/worklets/pcm-playback.js";

const MEDIA_ERROR_PREFIX = "No se pudo acceder al micrófono";
const DURATION_CAP_NOTICE =
  "Se alcanzó el tope de duración de la sesión de voz. Podés iniciar otra cuando quieras.";
const TRANSCRIPTION_LOST_NOTICE =
  "Se perdió la transcripción en vivo de tu voz; el asistente sigue respondiendo.";

const MAX_TRANSCRIPTION_RECONNECTS = 2;

interface VoiceTokenPayload {
  token: string;
  model: string;
  expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVoiceTokenPayload(value: unknown): value is VoiceTokenPayload {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    typeof value.model === "string"
  );
}

async function toFrameText(raw: unknown): Promise<string> {
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (typeof Blob !== "undefined" && raw instanceof Blob) return raw.text();
  return "";
}

export interface UseVoiceSessionOptions {
  maxSessionMinutes: number;
  /**
   * Entrega los turnos cerrados al chat. `ChatWidget` los inyecta en el estado
   * de `useChatStream`, así el autosave del texto los persiste en el historial.
   */
  onTurnsCommitted: (turns: VoiceTranscriptTurn[]) => void;
}

export interface UseVoiceSessionResult {
  status: VoiceSessionStatus;
  activity: VoiceActivity;
  liveUserText: string;
  liveAssistantText: string;
  error: string | null;
  notice: string | null;
  isActive: boolean;
  canStart: boolean;
  /** Turno push-to-talk en curso (el usuario está hablando). */
  isRecording: boolean;
  start: () => Promise<void>;
  stop: () => void;
  startTurn: () => void;
  endTurn: () => void;
  clearNotice: () => void;
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  const [state, dispatch] = useReducer(
    voiceSessionReducer,
    undefined,
    createInitialVoiceSessionState,
  );
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const conversationSocketRef = useRef<WebSocket | null>(null);
  const transcriptionSocketRef = useRef<WebSocket | null>(null);
  const conversationPurposeRef = useRef<"initial" | "reconnect">("initial");
  const conversationOpenedRef = useRef(false);
  const closingRef = useRef(false);
  const recordingRef = useRef(false);
  const resumptionHandleRef = useRef<string | null>(null);
  const transcriptionReconnectsRef = useRef(0);
  const reopenTranscriptionSocketRef = useRef<() => void>(() => {});

  const streamRef = useRef<MediaStream | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);

  const pendingUserRef = useRef("");
  const pendingAssistantRef = useRef("");
  const maxSessionMinutesRef = useRef(options.maxSessionMinutes);
  const onTurnsCommittedRef = useRef(options.onTurnsCommitted);
  const durationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptReconnectRef = useRef<() => void>(() => {});
  const stateRef = useRef(state);

  useEffect(() => {
    maxSessionMinutesRef.current = options.maxSessionMinutes;
    onTurnsCommittedRef.current = options.onTurnsCommitted;
    stateRef.current = state;
  });

  const requestToken = useCallback(async (purpose: LiveTokenPurpose): Promise<string> => {
    const response = await fetch("/api/chat/voice/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose }),
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `No se pudo iniciar la voz (${response.status})`;
      throw new Error(message);
    }

    if (!isVoiceTokenPayload(payload)) {
      throw new Error("Respuesta de token de voz inválida");
    }

    return payload.token;
  }, []);

  const sendToConversation = useCallback((message: unknown) => {
    const socket = conversationSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }, []);

  const sendToTranscription = useCallback((message: unknown) => {
    const socket = transcriptionSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }, []);

  const commitTurn = useCallback(() => {
    const user = pendingUserRef.current.trim();
    const assistant = pendingAssistantRef.current.trim();
    pendingUserRef.current = "";
    pendingAssistantRef.current = "";
    setLiveUserText("");
    setLiveAssistantText("");

    const turns: VoiceTranscriptTurn[] = [];
    if (user) turns.push({ role: "user", content: user });
    if (assistant) turns.push({ role: "assistant", content: assistant });
    if (turns.length === 0) return;

    onTurnsCommittedRef.current(turns);
  }, []);

  const flushPlayback = useCallback(() => {
    playbackNodeRef.current?.port.postMessage({ type: "flush" });
  }, []);

  const playAudio = useCallback((data: string) => {
    const node = playbackNodeRef.current;
    if (!node) return;
    node.port.postMessage({ samples: pcm16ToFloat32(base64ToPcm16(data)) });
  }, []);

  const stopMedia = useCallback(() => {
    playbackNodeRef.current?.port.postMessage({ type: "flush" });
    captureNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    captureNodeRef.current = null;
    sourceNodeRef.current = null;
    playbackNodeRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    void captureContextRef.current?.close().catch(() => {});
    captureContextRef.current = null;
    void playbackContextRef.current?.close().catch(() => {});
    playbackContextRef.current = null;
  }, []);

  const startMedia = useCallback(async () => {
    if (streamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const captureContext = new AudioContext();
      await captureContext.audioWorklet.addModule(CAPTURE_WORKLET_URL);
      const source = captureContext.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(captureContext, "pcm-capture");

      captureNode.port.onmessage = (event: MessageEvent) => {
        const chunk: unknown = event.data;
        if (!(chunk instanceof Float32Array)) return;
        // Solo se manda audio mientras el usuario mantiene su turno (push-to-talk).
        if (!recordingRef.current) return;

        const base64 = pcm16ToBase64(
          float32ToPcm16(downsampleTo16k(chunk, captureContext.sampleRate)),
        );
        // Conversación: clientContent (realtimeInput.audio se ignora en 3.8-live).
        sendToConversation(buildConversationAudioMessage(base64));
        // Transcripción: realtimeInput.audio en su propio socket.
        sendToTranscription(buildTranscriptionAudioMessage(base64));
      };

      // El worklet no procesa si no llega a destination; el gain en 0 evita eco.
      const mute = captureContext.createGain();
      mute.gain.value = 0;
      source.connect(captureNode);
      captureNode.connect(mute);
      mute.connect(captureContext.destination);

      sourceNodeRef.current = source;
      captureNodeRef.current = captureNode;
      captureContextRef.current = captureContext;

      const playbackContext = new AudioContext({ sampleRate: 24000 });
      await playbackContext.audioWorklet.addModule(PLAYBACK_WORKLET_URL);
      const playbackNode = new AudioWorkletNode(playbackContext, "pcm-playback");
      playbackNode.connect(playbackContext.destination);

      playbackContextRef.current = playbackContext;
      playbackNodeRef.current = playbackNode;
    } catch (mediaError) {
      const detail = mediaError instanceof Error ? mediaError.message : "permiso denegado";
      setError(`${MEDIA_ERROR_PREFIX}: ${detail}`);
      setNotice("Sin permiso de micrófono no se puede usar la voz.");
      closingRef.current = true;
      recordingRef.current = false;
      setIsRecording(false);
      stopMedia();
      dispatch({ type: "stop" });
    }
  }, [sendToConversation, sendToTranscription, stopMedia]);

  const handleToolCall = useCallback(
    async (functionCalls: LiveFunctionCall[]) => {
      if (functionCalls.length === 0) return;

      const functionResponses: LiveFunctionResponse[] = await Promise.all(
        functionCalls.map(async (call) => {
          let response: Record<string, unknown>;

          try {
            const result = await fetch("/api/chat/voice/tool", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: call.name, args: call.args }),
            });
            const payload: unknown = await result.json().catch(() => null);

            if (result.ok && isRecord(payload) && "result" in payload) {
              const value = (payload as { result: unknown }).result;
              response = isRecord(value) ? value : { result: value ?? null };
            } else {
              response = {
                error:
                  isRecord(payload) && typeof payload.error === "string"
                    ? payload.error
                    : "Error al ejecutar la herramienta",
              };
            }
          } catch {
            response = { error: "No se pudo ejecutar la herramienta." };
          }

          return { id: call.id, name: call.name, response };
        }),
      );

      // Forma verificada contra la API real.
      sendToConversation(buildToolResponseMessage(functionResponses));
    },
    [sendToConversation],
  );

  const handleConversationEvent = useCallback(
    (event: LiveServerEvent) => {
      dispatch({ type: "server-event", event });

      switch (event.type) {
        case "audio":
          playAudio(event.data);
          break;
        case "output-transcript":
          pendingAssistantRef.current = mergeTranscriptText(
            pendingAssistantRef.current,
            event.text,
          );
          setLiveAssistantText(pendingAssistantRef.current);
          break;
        case "input-transcript":
          pendingUserRef.current = mergeTranscriptText(pendingUserRef.current, event.text);
          setLiveUserText(pendingUserRef.current);
          break;
        case "interrupted":
          flushPlayback();
          break;
        case "turn-complete":
          commitTurn();
          break;
        case "tool-call":
          void handleToolCall(event.functionCalls);
          break;
        case "resumption-update":
          if (event.newHandle) resumptionHandleRef.current = event.newHandle;
          break;
        case "error":
          setError(event.message);
          break;
        default:
          break;
      }
    },
    [commitTurn, flushPlayback, handleToolCall, playAudio],
  );

  const openTranscriptionSocket = useCallback((token: string) => {
    const socket = new WebSocket(`${LIVE_WS_URL}?access_token=${token}`);
    socket.binaryType = "arraybuffer";
    transcriptionSocketRef.current = socket;

    socket.onopen = () => {
      // Config fijada en el token; setup primero y único. La transcripción no
      // necesita resumption ni compresión.
      socket.send(JSON.stringify(buildTranscriptionSetupMessage()));
    };

    socket.onmessage = (event: MessageEvent) => {
      void (async () => {
        const events = normalizeLiveServerMessage(await toFrameText(event.data));
        for (const serverEvent of events) {
          if (serverEvent.type === "input-transcript") {
            pendingUserRef.current = mergeTranscriptText(
              pendingUserRef.current,
              serverEvent.text,
            );
            setLiveUserText(pendingUserRef.current);
          } else if (serverEvent.type === "error") {
            setError(serverEvent.message);
          }
          // Este modelo no manda turnComplete: no se espera ni se cierra nada.
        }
      })();
    };

    socket.onclose = () => {
      if (closingRef.current || transcriptionSocketRef.current !== socket) return;
      transcriptionSocketRef.current = null;
      reopenTranscriptionSocketRef.current();
    };
  }, []);

  const reopenTranscriptionSocket = useCallback(() => {
    void (async () => {
      if (closingRef.current) return;

      if (transcriptionReconnectsRef.current >= MAX_TRANSCRIPTION_RECONNECTS) {
        setNotice(TRANSCRIPTION_LOST_NOTICE);
        return;
      }
      transcriptionReconnectsRef.current += 1;

      try {
        const token = await requestToken("transcription");
        if (closingRef.current) return;
        openTranscriptionSocket(token);
      } catch {
        setNotice(TRANSCRIPTION_LOST_NOTICE);
      }
    })();
  }, [openTranscriptionSocket, requestToken]);

  useEffect(() => {
    reopenTranscriptionSocketRef.current = reopenTranscriptionSocket;
  }, [reopenTranscriptionSocket]);

  const openConversationSocket = useCallback(
    (token: string, resumptionHandle: string | undefined, purpose: "initial" | "reconnect") => {
      closingRef.current = false;
      conversationOpenedRef.current = false;
      conversationPurposeRef.current = purpose;

      const socket = new WebSocket(`${LIVE_WS_URL}?access_token=${token}`);
      socket.binaryType = "arraybuffer";
      conversationSocketRef.current = socket;

      socket.onopen = () => {
        conversationOpenedRef.current = true;
        socket.send(JSON.stringify(buildConversationSetupMessage(resumptionHandle)));
        dispatch({ type: "socket-open" });
        void startMedia();
      };

      socket.onmessage = (event: MessageEvent) => {
        void (async () => {
          for (const serverEvent of normalizeLiveServerMessage(await toFrameText(event.data))) {
            handleConversationEvent(serverEvent);
          }
        })();
      };

      socket.onerror = () => {
        // El cierre que sigue decide si se reconecta.
      };

      socket.onclose = () => {
        if (closingRef.current || conversationSocketRef.current !== socket) return;
        conversationSocketRef.current = null;
        recordingRef.current = false;
        setIsRecording(false);
        stopMedia();

        if (conversationPurposeRef.current === "reconnect" && !conversationOpenedRef.current) {
          dispatch({ type: "reconnect-failed" });
          return;
        }

        if (conversationPurposeRef.current === "initial" && !conversationOpenedRef.current) {
          setError("No se pudo conectar con la sesión de voz.");
        }

        dispatch({ type: "connection-lost" });
      };
    },
    [handleConversationEvent, startMedia, stopMedia],
  );

  const attemptReconnect = useCallback(() => {
    void (async () => {
      // Si el usuario detuvo la sesión mientras se minteaba el token, no reabrir.
      if (closingRef.current) return;

      try {
        const token = await requestToken("conversation");
        if (closingRef.current) return;
        openConversationSocket(token, resumptionHandleRef.current ?? undefined, "reconnect");

        // El socket de transcripción puede haber caído por su cuenta.
        if (!transcriptionSocketRef.current) {
          reopenTranscriptionSocketRef.current();
        }
      } catch {
        if (!closingRef.current) dispatch({ type: "reconnect-failed" });
      }
    })();
  }, [openConversationSocket, requestToken]);

  useEffect(() => {
    attemptReconnectRef.current = attemptReconnect;
  }, [attemptReconnect]);

  // Al entrar en `reconnecting` (o al fallar un intento y seguir en ese estado),
  // se mintea un token nuevo y se retoma con el handle.
  useEffect(() => {
    if (state.status !== "reconnecting") return;
    const timer = setTimeout(() => attemptReconnectRef.current(), 0);
    return () => clearTimeout(timer);
  }, [state.status, state.reconnectAttempts]);

  const clearDurationCap = useCallback(() => {
    if (durationTimerRef.current) {
      clearTimeout(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const teardownSockets = useCallback(() => {
    const conversation = conversationSocketRef.current;
    conversationSocketRef.current = null;
    if (conversation && conversation.readyState <= WebSocket.OPEN) {
      try {
        conversation.close();
      } catch {
        // ya cerrado
      }
    }

    const transcription = transcriptionSocketRef.current;
    transcriptionSocketRef.current = null;
    if (transcription && transcription.readyState <= WebSocket.OPEN) {
      try {
        transcription.close();
      } catch {
        // ya cerrado
      }
    }
  }, []);

  const startDurationCap = useCallback(() => {
    clearDurationCap();
    const minutes = Math.max(1, maxSessionMinutesRef.current);
    durationTimerRef.current = setTimeout(() => {
      dispatch({ type: "duration-cap-reached" });
      setNotice(DURATION_CAP_NOTICE);
      closingRef.current = true;
      recordingRef.current = false;
      setIsRecording(false);
      commitTurn();
      stopMedia();
      teardownSockets();
    }, minutes * 60_000);
  }, [clearDurationCap, commitTurn, stopMedia, teardownSockets]);

  const stop = useCallback(() => {
    closingRef.current = true;
    clearDurationCap();
    recordingRef.current = false;
    setIsRecording(false);
    flushPlayback();
    commitTurn();
    stopMedia();
    teardownSockets();
    dispatch({ type: "stop" });
  }, [clearDurationCap, commitTurn, flushPlayback, stopMedia, teardownSockets]);

  const startTurn = useCallback(() => {
    if (stateRef.current.status !== "active") return;
    if (recordingRef.current) return;

    recordingRef.current = true;
    setIsRecording(true);
    pendingUserRef.current = "";
    pendingAssistantRef.current = "";
    setLiveUserText("");
    setLiveAssistantText("");
  }, []);

  const endTurn = useCallback(() => {
    if (!recordingRef.current) return;

    recordingRef.current = false;
    setIsRecording(false);
    // Cierre del turno del usuario: SIEMPRE en el socket de conversación.
    sendToConversation(buildConversationTurnCompleteMessage());
    // El socket de transcripción cierra su stream de audio (no hay turnComplete).
    sendToTranscription(buildTranscriptionStreamEndMessage());
  }, [sendToConversation, sendToTranscription]);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    setIsRecording(false);
    setLiveUserText("");
    setLiveAssistantText("");
    pendingUserRef.current = "";
    pendingAssistantRef.current = "";
    resumptionHandleRef.current = null;
    transcriptionReconnectsRef.current = 0;
    recordingRef.current = false;
    closingRef.current = false;

    dispatch({ type: "start" });

    let conversationToken: string;
    let transcriptionToken: string;
    try {
      [conversationToken, transcriptionToken] = await Promise.all([
        requestToken("conversation"),
        requestToken("transcription"),
      ]);
    } catch (tokenError) {
      const message =
        tokenError instanceof Error ? tokenError.message : "No se pudo iniciar la voz";
      setError(message);
      dispatch({ type: "token-failed", message });
      return;
    }

    dispatch({ type: "token-acquired" });
    openConversationSocket(conversationToken, undefined, "initial");
    openTranscriptionSocket(transcriptionToken);
    startDurationCap();
  }, [openConversationSocket, openTranscriptionSocket, requestToken, startDurationCap]);

  // Limpieza al desmontar: nunca dejar el micrófono ni los sockets abiertos.
  useEffect(() => {
    return () => {
      closingRef.current = true;
      clearDurationCap();
      stopMedia();
      teardownSockets();
    };
  }, [clearDurationCap, stopMedia, teardownSockets]);

  const isActive =
    state.status === "requesting-token" ||
    state.status === "connecting" ||
    state.status === "active" ||
    state.status === "reconnecting";

  return {
    status: state.status,
    activity: state.activity,
    liveUserText,
    liveAssistantText,
    error,
    notice,
    isActive,
    canStart: state.status === "idle" || state.status === "ended" || state.status === "error",
    isRecording,
    start,
    stop,
    startTurn,
    endTurn,
    clearNotice: () => setNotice(null),
  };
}
