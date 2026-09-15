/**
 * Normalización de mensajes del servidor de Gemini Live.
 *
 * Módulo puro: convierte el frame crudo (string JSON u objeto) en una lista de
 * eventos tipados y consumibles. Un mismo mensaje puede producir **varios**
 * eventos (por ejemplo `modelTurn` con audio + transcripción + `turnComplete`).
 *
 * Particularidades verificadas contra la API real:
 *  - llegan **mensajes vacíos `{}`** (y claves de telemetría como
 *    `generationComplete`/`usageMetadata`) que hay que ignorar sin error;
 *  - entrada inválida → `unknown`, nunca una excepción: un frame raro no debe
 *    tumbar la sesión de voz.
 */

export interface LiveFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LiveServerEvent =
  | { type: "setup-complete" }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "input-transcript"; text: string }
  | { type: "output-transcript"; text: string }
  | { type: "interrupted" }
  | { type: "turn-complete" }
  | { type: "tool-call"; functionCalls: LiveFunctionCall[] }
  | { type: "tool-cancellation"; ids: string[] }
  | { type: "resumption-update"; resumable: boolean; newHandle?: string }
  | { type: "go-away"; timeLeft?: string }
  | { type: "error"; message: string }
  | { type: "unknown" };

const UNKNOWN: LiveServerEvent = { type: "unknown" };

/** Claves que el servidor manda y no producen eventos (telemetría/ruido). */
const IGNORED_KEYS = new Set(["usageMetadata", "generationComplete"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseFrame(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return parseFrame(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  return asRecord(raw);
}

function normalizeServerContent(serverContent: Record<string, unknown>): LiveServerEvent[] {
  const events: LiveServerEvent[] = [];

  const modelTurn = asRecord(serverContent.modelTurn);
  const parts = modelTurn && Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
  for (const part of parts) {
    const inlineData = asRecord(asRecord(part)?.inlineData);
    if (!inlineData) continue;

    const data = inlineData.data;
    if (typeof data !== "string" || data.length === 0) continue;

    events.push({
      type: "audio",
      data,
      mimeType:
        typeof inlineData.mimeType === "string" ? inlineData.mimeType : "audio/pcm;rate=24000",
    });
  }

  const inputTranscription = asRecord(serverContent.inputTranscription);
  if (inputTranscription && typeof inputTranscription.text === "string") {
    events.push({ type: "input-transcript", text: inputTranscription.text });
  }

  const outputTranscription = asRecord(serverContent.outputTranscription);
  if (outputTranscription && typeof outputTranscription.text === "string") {
    events.push({ type: "output-transcript", text: outputTranscription.text });
  }

  if (serverContent.interrupted === true) {
    events.push({ type: "interrupted" });
  }

  if (serverContent.turnComplete === true) {
    events.push({ type: "turn-complete" });
  }

  return events;
}

function normalizeToolCall(toolCall: Record<string, unknown>): LiveServerEvent | null {
  if (!Array.isArray(toolCall.functionCalls)) return null;

  const functionCalls: LiveFunctionCall[] = toolCall.functionCalls.map((rawCall) => {
    const call = asRecord(rawCall) ?? {};
    return {
      id: typeof call.id === "string" ? call.id : "",
      name: typeof call.name === "string" ? call.name : "",
      args: asRecord(call.args) ?? {},
    };
  });

  return { type: "tool-call", functionCalls };
}

export function normalizeLiveServerMessage(raw: unknown): LiveServerEvent[] {
  const message = parseFrame(raw);
  if (!message) return [UNKNOWN];

  const keys = Object.keys(message);
  if (keys.length === 0) return [];

  const setupComplete = has(message, "setupComplete");
  const serverContent = asRecord(message.serverContent);
  const toolCall = asRecord(message.toolCall);
  const toolCallCancellation = asRecord(message.toolCallCancellation);
  const resumptionUpdate = asRecord(message.sessionResumptionUpdate);
  const hasGoAway = has(message, "goAway");
  const hasError = has(message, "error");

  const recognized =
    setupComplete ||
    serverContent !== null ||
    toolCall !== null ||
    toolCallCancellation !== null ||
    resumptionUpdate !== null ||
    hasGoAway ||
    hasError;

  if (!recognized) {
    return keys.every((key) => IGNORED_KEYS.has(key)) ? [] : [UNKNOWN];
  }

  const events: LiveServerEvent[] = [];

  if (setupComplete) {
    events.push({ type: "setup-complete" });
  }

  if (serverContent) {
    events.push(...normalizeServerContent(serverContent));
  }

  if (toolCall) {
    const event = normalizeToolCall(toolCall);
    if (event) events.push(event);
  }

  if (toolCallCancellation && Array.isArray(toolCallCancellation.ids)) {
    events.push({
      type: "tool-cancellation",
      ids: toolCallCancellation.ids.filter((id): id is string => typeof id === "string"),
    });
  }

  if (resumptionUpdate) {
    const newHandle = resumptionUpdate.newHandle;
    events.push({
      type: "resumption-update",
      resumable: resumptionUpdate.resumable === true,
      ...(typeof newHandle === "string" && newHandle.length > 0 ? { newHandle } : {}),
    });
  }

  if (hasGoAway) {
    const goAway = asRecord(message.goAway) ?? {};
    const timeLeft = goAway.timeLeft;
    events.push({
      type: "go-away",
      ...(typeof timeLeft === "string" && timeLeft.length > 0 ? { timeLeft } : {}),
    });
  }

  if (hasError) {
    const rawError = message.error;
    const errorMessage = typeof rawError === "string"
      ? rawError
      : asRecord(rawError) && typeof (rawError as Record<string, unknown>).message === "string"
        ? ((rawError as Record<string, unknown>).message as string)
        : "Error desconocido de la sesión de voz";
    events.push({ type: "error", message: errorMessage });
  }

  return events;
}
