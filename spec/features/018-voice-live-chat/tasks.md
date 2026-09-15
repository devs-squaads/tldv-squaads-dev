# 018 · Voz en tiempo real en el chat (Gemini Live) — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._
_Orden TDD (RED → GREEN → REFACTOR): primero el test que falla, luego el código mínimo que lo pasa. Tests en `apps/__tests__/web/modules/chat/voice/` y `apps/__tests__/web/routes/` (ver `../../constitution/tech-stack.md` → Testing)._

## Corrección de protocolo (2026-09-15, verificada con voz real)

El primer intento fijó `realtimeInput.audio` para la conversación: en `gemini-3.8-live` esos mensajes
**se ignoran en silencio** (sin error, sin transcripción, sin respuesta). Corregido:

- Conversación: audio por **`clientContent`** (`turns[0].parts[0].inlineData`) y cierre de turno con
  **`{ clientContent: { turnComplete: true } }`**. Nada de `realtimeInput.audio` ni `audioStreamEnd`.
- La voz del usuario se transcribe en un **segundo socket** con `gemini-3.5-transcribe-live`
  (`realtimeInput.audio` + `audioStreamEnd` + `inputTranscription`); ese modelo **no** manda
  `turnComplete`. El socket de conversación no entrega `inputTranscription`.
- Las restricciones del token de conversación quedan **solo** en `model` + `responseModalities:
  ["AUDIO"]` + `systemInstruction` + `tools` (`BLOCKING`). `sessionResumption` y
  `contextWindowCompression` los aporta el **cliente** en su `setup` (el servidor ya manda el handle).
- Interfaz v1 **push-to-talk por click**: un click inicia el turno, otro lo termina.
- El servidor manda mensajes vacíos `{}` (y `generationComplete`/`usageMetadata`) que se ignoran.

## Fase 1 · Lógica pura (TDD)

- [x] RED `apps/__tests__/web/modules/chat/voice/voice-policy.test.ts` — default apagado, `true` enciende, modelo por defecto `gemini-3.8-live`, modelo de transcripción `gemini-3.5-transcribe-live`, tope 15 min, valor inválido → default con motivo.
- [x] GREEN `apps/web/src/modules/chat/voice/voicePolicy.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/live-token-request.test.ts` — `bidiGenerateContentSetup` de **conversación** (`AUDIO`, `systemInstruction`, `tools` `BLOCKING`) **sin** `sessionResumption`/`contextWindowCompression`/`inputAudioTranscription`; de **transcripción** (`TEXT` + `inputAudioTranscription: { languageCodes: [] }`, sin prompt ni tools); `parseAuthTokenResponse` acepta `name` y lanza ante respuesta sin `name`.
- [x] GREEN `apps/web/src/modules/chat/voice/liveTokenRequest.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/live-events.test.ts` — `setupComplete`, audio `inlineData` (24 kHz), `inputTranscription`/`outputTranscription`, `interrupted`, `turnComplete`, `toolCall`, `toolCallCancellation`, `sessionResumptionUpdate`, `goAway`, mensaje inválido → `unknown` sin excepción, un mensaje que produce varios eventos, **`{}` y `generationComplete`/`usageMetadata` → sin eventos**.
- [x] GREEN `apps/web/src/modules/chat/voice/liveEvents.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/live-client-messages.test.ts` — audio de conversación por `clientContent` (**NUNCA** `realtimeInput`), cierre con `clientContent.turnComplete`, audio de transcripción por `realtimeInput.audio` + `audioStreamEnd`, setup de conversación con `contextWindowCompression` (y handle al reconectar), setup de transcripción vacío, `toolResponse.functionResponses`.
- [x] GREEN `apps/web/src/modules/chat/voice/liveClientMessages.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/pcm.test.ts` — downsample de 48k→16k conservando longitud y amplitud, ida y vuelta PCM16↔float32, base64 con framing correcto.
- [x] GREEN `apps/web/src/modules/chat/voice/pcm.ts`.
- [x] RED `apps/__tests__/web/integrations/chat-prompt-channel.test.ts` — `BASE_CHAT_RULES` byte-idéntico al texto actual (string esperado fijado en el test) y **con** `[SUGGESTIONS]`; `VOICE_CHAT_RULES` **sin** `[SUGGESTIONS]` ni bloque JSON de `payload`; `assembleChatSystemPrompt({ channel: "voice" })` sin el bloque y sin `channel` con el mismo `systemContent` que hoy.
  - Nota: la aserción `no payload` se acotó a `"payload"` (el bloque JSON). `CORE_RULES` (líneas 6-21, byte-idéntico) menciona `payload.id` en la regla anti-alucinación; prohibir la palabra suelta rompería el byte-lock del chat de texto. **Aceptado por el revisor.**
- [x] GREEN `apps/web/src/integrations/chat/knowledge/staticKnowledge.ts` (partir en `CORE_RULES` + `SUGGESTIONS_RULES` + `VOICE_OUTPUT_RULES`) y `promptAssembler.ts` (parámetro `channel`, default `"text"`).
- [x] RED `apps/__tests__/web/integrations/gemini-schema.test.ts` — mapeo JSON Schema → Gemini: `string/number/boolean/array/object`, `enum`, anidados, `properties` vacío, tipo desconocido → `STRING`.
- [x] GREEN `apps/web/src/integrations/chat/tools/geminiSchema.ts` — extracción pura de `toGeminiType`/`toGeminiSchema` desde `GeminiChatProvider.ts`, importada por el provider **sin cambio de comportamiento**.
- [x] RED `apps/__tests__/web/modules/chat/voice/voice-session-state.test.ts` — transiciones completas, reconexión solo si es resumible, cierre por tope de duración, error terminal tras dos reconexiones fallidas.
- [x] GREEN `apps/web/src/modules/chat/voice/voiceSessionState.ts`.
- [x] REFACTOR — suite en verde, sin cambio de comportamiento.

## Fase 2 · Rutas (TDD)

- [x] RED `apps/__tests__/web/routes/chat-voice-config-route.test.ts` — `401` sin sesión, `{ enabled: false }` con el flag apagado, `{ enabled: true, model, maxSessionMinutes }` encendido.
- [x] RED `apps/__tests__/web/routes/chat-voice-token-route.test.ts` — `401` sin sesión, `503` con la feature apagada **sin llamar a Google**, `429` al superar el cupo, `400` con `purpose` inválido, `200` con `{ token, model, expiresAt }` y `uses: 1`; conversación sin `sessionResumption`/`contextWindowCompression`; **transcripción** sin prompt/tools y sin tocar la DB; el cupo se consume **una vez por sesión**; error de Google → `502`.
- [x] GREEN `apps/web/src/app/api/chat/voice/config/route.ts` y `apps/web/src/app/api/chat/voice/token/route.ts` (con `purpose: "conversation" | "transcription"`).
- [x] RED `apps/__tests__/web/routes/chat-voice-tool-route.test.ts` — puente de tools: `401` sin sesión, `503` apagada, `403` con una tool mutating (`enqueue_meeting`, `manage_meeting_share`) **sin ejecutarla**, `200` con `{ result }` para una tool de lectura, `500` si la tool lanza sin filtrar el error interno.
- [x] GREEN `apps/web/src/app/api/chat/voice/tool/route.ts` — valida contra `READ_ONLY_TOOLS` y ejecuta en el servidor (el browser nunca ejecuta tools).
- [x] Verificar que el prompt y las tools se arman con `assembleChatSystemPrompt(channel: "voice")` + `buildUserContext` + `READ_ONLY_TOOLS` (ninguna tool mutating en el payload) y que las declaraciones van con `behavior: "BLOCKING"`.
- [x] REFACTOR.

## Fase 3 · Cliente (validación por integración/manual)

- [x] `apps/web/src/components/chat/useVoiceSession.ts`: `getUserMedia`, AudioWorklet, **dos sockets** (conversación + transcripción), audio de conversación por `clientContent`, cierre por `clientContent.turnComplete`, audio de transcripción por `realtimeInput.audio` + `audioStreamEnd`, playback 24 kHz, `interrupted` corta la reproducción, reconexión con token nuevo + handle, push-to-talk por click.
- [x] Worklets `apps/web/public/worklets/pcm-capture.js` y `pcm-playback.js`.
- [x] Botón de micrófono y estado (escuchando / hablando / grabando / reconectando / error) en `ChatInput.tsx` y `ChatWidget.tsx`, oculto si `enabled` es `false`.
- [x] Persistencia de los turnos cerrados: cambio **aditivo** `appendMessages` en `useChatStream` — los turnos entran al mismo estado que persiste el autosave, así el historial de texto y el de voz no se pisan. Se eliminó la escritura propia contra `/api/chat/history`.
- [ ] Validación manual registrada: permiso concedido, permiso denegado, barge-in, corte de reconexión, tope de duración alcanzado.
  - **PENDIENTE**: sin navegador ni micrófono en este entorno. La implementación está completa; queda ejecutar la prueba manual (navegador real, AudioWorklet, permiso denegado, barge-in, reconexión y tope). El revisor ya validó el protocolo de audio con voz real contra la API.
  - **Verificado por el revisor (2026-09-16)**: dos sockets en paralelo con tokens efímeros restringidos y `setup: {}` → la voz del usuario sale por el socket STT (`"¿Cuántas reuniones completadas tengo en el sistema?"`), el asistente llama a `search_meetings`, recibe la respuesta con la forma del puente y contesta por voz (`"Hay cuatro reuniones completadas en el sistema."`, ~136 KB de audio). Además: el **mismo socket STT sirve para varios turnos** (dos turnos consecutivos transcritos correctamente), así que no hay que re-mintear token por turno. Lo que queda pendiente es solo lo que depende del navegador (permisos, AudioWorklet, barge-in, reconexión a los ~10 min).

## Fase 4 · Cierre

- [x] Env en `README.md` + `.env.development.example` + `.env.production.example` (`VOICE_CHAT_ENABLED`, `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_TRANSCRIBE_MODEL`, `VOICE_CHAT_MAX_SESSION_MINUTES`) con el coste del socket de transcripción documentado (~$0.009/min).
- [x] Aviso de privacidad en la UI antes de pedir el micrófono + nota en el README.
- [x] `bun run test`, `bun run lint`, `bun run typecheck` en verde.
- [ ] Validar contra los criterios de aceptación de `spec.md`.
  - **PENDIENTE**: los criterios verificables por tests están cubiertos; los que dependen de audio real (sesión devuelve audio + transcripción en vivo, reconexión a los ~10 min) quedan sujetos a la validación manual de Fase 3.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
  - **PENDIENTE**: no se mueve hasta ejecutar la validación manual (Fase 3).
