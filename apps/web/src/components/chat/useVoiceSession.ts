"use client";

/**
 * useVoiceSession — transporte de la voz en tiempo real.
 *
 * El navegador habla **directo** contra Gemini Live con un token efímero
 * minteado por el servidor; el audio no atraviesa nuestra infraestructura. La
 * configuración, la `systemInstruction` y las tools vienen fijadas en el token,
 * así que el único mensaje de arranque es `{ setup: {} }` — y en reconexión,
 * `{ setup: { sessionResumption: { handle } } }` con un token **nuevo**
 * (reusar uno cierra con 1011).
 *
 * Toda la lógica de decisión vive en módulos puros (`liveEvents`,
 * `voiceSessionState`, `pcm`); acá solo hay efectos de navegador y red.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { DisplayMessage } from "@/components/chat/useChatStream";
import {
  mergeTranscriptText,
  type VoiceTranscriptTurn,
} from "@/components/chat/voiceWidget.logic";
import {
  normalizeLiveServerMessage,
  type LiveFunctionCall,
} from "@/modules/chat/voice/liveEvents";
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
  history: DisplayMessage[];
  maxSessionMinutes: number;
}

export interface UseVoiceSessionResult {
  status: VoiceSessionStatus;
  activity: VoiceActivity;
  turns: VoiceTranscriptTurn[];
  liveUserText: string;
  liveAssistantText: string;
  error: string | null;
  notice: string | null;
  isActive: boolean;
  canStart: boolean;
  start: () => Promise<void>;
  stop: () => void;
  clearNotice: () => void;
}

export function useVoiceSession(options: UseVoiceSessionOptions): UseVoiceSessionResult {
  const [state, dispatch] = useReducer(
    voiceSessionReducer,
    undefined,
    createInitialVoiceSessionState,
  );
  const [turns, setTurns] = useState<VoiceTranscriptTurn[]>([]);
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const socketPurposeRef = useRef<"initial" | "reconnect">("initial");
  const openedRef = useRef(false);
  const closingRef = useRef(false);
  const resumptionHandleRef = useRef<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);

  const pendingUserRef = useRef("");
  const pendingAssistantRef = useRef("");
  const persistedTurnsRef = useRef<VoiceTranscriptTurn[]>([]);
  const historyRef = useRef<DisplayMessage[]>(options.history);
  const maxSessionMinutesRef = useRef(options.maxSessionMinutes);
  const durationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptReconnectRef = useRef<() => void>(() => {});

  useEffect(() => {
    historyRef.current = options.history;
    maxSessionMinutesRef.current = options.maxSessionMinutes;
  });

  const sendRealtime = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  }, []);

  const requestToken = useCallback(async (): Promise<string> => {
    const response = await fetch("/api/chat/voice/token", { method: "POST" });
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

  const persistHistory = useCallback(() => {
    const messages = [
      ...historyRef.current.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...persistedTurnsRef.current,
    ];

    void fetch("/api/chat/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    }).catch(() => {
      // Silencioso: la sesión sigue viva aunque falle la persistencia.
    });
  }, []);

  const commitTurn = useCallback(() => {
    const user = pendingUserRef.current.trim();
    const assistant = pendingAssistantRef.current.trim();
    pendingUserRef.current = "";
    pendingAssistantRef.current = "";
    setLiveUserText("");
    setLiveAssistantText("");

    const newTurns: VoiceTranscriptTurn[] = [];
    if (user) newTurns.push({ role: "user", content: user });
    if (assistant) newTurns.push({ role: "assistant", content: assistant });
    if (newTurns.length === 0) return;

    setTurns((previous) => [...previous, ...newTurns]);
    persistedTurnsRef.current = [...persistedTurnsRef.current, ...newTurns];
    persistHistory();
  }, [persistHistory]);

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
        const downsampled = downsampleTo16k(chunk, captureContext.sampleRate);
        sendRealtime({
          realtimeInput: {
            audio: {
              data: pcm16ToBase64(float32ToPcm16(downsampled)),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        });
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
      stopMedia();
      dispatch({ type: "stop" });
    }
  }, [sendRealtime, stopMedia]);

  const handleToolCall = useCallback(
    async (functionCalls: LiveFunctionCall[]) => {
      if (functionCalls.length === 0) return;

      const functionResponses = await Promise.all(
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
      sendRealtime({ toolResponse: { functionResponses } });
    },
    [sendRealtime],
  );

  const handleMessage = useCallback(
    async (raw: unknown) => {
      const frame = await toFrameText(raw);
      const events = normalizeLiveServerMessage(frame);

      for (const event of events) {
        dispatch({ type: "server-event", event });

        switch (event.type) {
          case "audio":
            playAudio(event.data);
            break;
          case "input-transcript":
            pendingUserRef.current = mergeTranscriptText(
              pendingUserRef.current,
              event.text,
            );
            setLiveUserText(pendingUserRef.current);
            break;
          case "output-transcript":
            pendingAssistantRef.current = mergeTranscriptText(
              pendingAssistantRef.current,
              event.text,
            );
            setLiveAssistantText(pendingAssistantRef.current);
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
      }
    },
    [commitTurn, flushPlayback, handleToolCall, playAudio],
  );

  const openSocket = useCallback(
    (token: string, resumptionHandle: string | undefined, purpose: "initial" | "reconnect") => {
      closingRef.current = false;
      openedRef.current = false;
      socketPurposeRef.current = purpose;

      const socket = new WebSocket(`${LIVE_WS_URL}?access_token=${token}`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        openedRef.current = true;
        // `setup` debe ser el primer y único mensaje inicial. La config ya viene
        // fijada dentro del token; en reconexión solo se manda el handle.
        if (resumptionHandle) {
          socket.send(JSON.stringify({ setup: { sessionResumption: { handle: resumptionHandle } } }));
        } else {
          socket.send(JSON.stringify({ setup: {} }));
        }

        dispatch({ type: "socket-open" });
        void startMedia();
      };

      socket.onmessage = (event: MessageEvent) => {
        void handleMessage(event.data);
      };

      socket.onerror = () => {
        // El cierre que sigue decide si se reconecta.
      };

      socket.onclose = () => {
        if (closingRef.current || socketRef.current !== socket) return;
        socketRef.current = null;
        stopMedia();

        if (socketPurposeRef.current === "reconnect" && !openedRef.current) {
          dispatch({ type: "reconnect-failed" });
          return;
        }

        if (socketPurposeRef.current === "initial" && !openedRef.current) {
          setError("No se pudo conectar con la sesión de voz.");
        }

        dispatch({ type: "connection-lost" });
      };
    },
    [handleMessage, startMedia, stopMedia],
  );

  const attemptReconnect = useCallback(() => {
    void (async () => {
      // Si el usuario detuvo la sesión mientras se minteaba el token, no reabrir.
      if (closingRef.current) return;

      try {
        const token = await requestToken();
        if (closingRef.current) return;
        openSocket(token, resumptionHandleRef.current ?? undefined, "reconnect");
      } catch {
        if (!closingRef.current) dispatch({ type: "reconnect-failed" });
      }
    })();
  }, [openSocket, requestToken]);

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

  const startDurationCap = useCallback(() => {
    clearDurationCap();
    const minutes = Math.max(1, maxSessionMinutesRef.current);
    durationTimerRef.current = setTimeout(() => {
      dispatch({ type: "duration-cap-reached" });
      setNotice(DURATION_CAP_NOTICE);
      closingRef.current = true;
      commitTurn();
      stopMedia();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) {
        try {
          socket.close();
        } catch {
          // ya cerrado
        }
      }
    }, minutes * 60_000);
  }, [clearDurationCap, commitTurn, stopMedia]);

  const stop = useCallback(() => {
    closingRef.current = true;
    clearDurationCap();
    flushPlayback();
    commitTurn();
    stopMedia();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try {
        socket.close();
      } catch {
        // ya cerrado
      }
    }
    dispatch({ type: "stop" });
  }, [clearDurationCap, commitTurn, flushPlayback, stopMedia]);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    setLiveUserText("");
    setLiveAssistantText("");
    pendingUserRef.current = "";
    pendingAssistantRef.current = "";
    resumptionHandleRef.current = null;
    closingRef.current = false;

    dispatch({ type: "start" });

    let token: string;
    try {
      token = await requestToken();
    } catch (tokenError) {
      const message =
        tokenError instanceof Error ? tokenError.message : "No se pudo iniciar la voz";
      setError(message);
      dispatch({ type: "token-failed", message });
      return;
    }

    dispatch({ type: "token-acquired" });
    openSocket(token, undefined, "initial");
    startDurationCap();
  }, [openSocket, requestToken, startDurationCap]);

  // Limpieza al desmontar: nunca dejar el micrófono ni el socket abiertos.
  useEffect(() => {
    return () => {
      closingRef.current = true;
      clearDurationCap();
      stopMedia();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) {
        try {
          socket.close();
        } catch {
          // ya cerrado
        }
      }
    };
  }, [clearDurationCap, stopMedia]);

  const isActive =
    state.status === "requesting-token" ||
    state.status === "connecting" ||
    state.status === "active" ||
    state.status === "reconnecting";

  return {
    status: state.status,
    activity: state.activity,
    turns,
    liveUserText,
    liveAssistantText,
    error,
    notice,
    isActive,
    canStart: state.status === "idle" || state.status === "ended" || state.status === "error",
    start,
    stop,
    clearNotice: () => setNotice(null),
  };
}
