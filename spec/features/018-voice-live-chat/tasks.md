# 018 · Voz en tiempo real en el chat (Gemini Live) — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._
_Orden TDD (RED → GREEN → REFACTOR): primero el test que falla, luego el código mínimo que lo pasa. Tests en `apps/__tests__/web/modules/chat/voice/` y `apps/__tests__/web/routes/` (ver `../../constitution/tech-stack.md` → Testing)._

## Fase 1 · Lógica pura (TDD)

- [x] RED `apps/__tests__/web/modules/chat/voice/voice-policy.test.ts` — default apagado, `true` enciende, modelo por defecto `gemini-3.8-live`, tope 15 min, valor inválido → default con motivo.
- [x] GREEN `apps/web/src/modules/chat/voice/voicePolicy.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/live-token-request.test.ts` — `bidiGenerateContentSetup` con `generationConfig.responseModalities: ["AUDIO"]`, `systemInstruction` y `tools`; `parseAuthTokenResponse` acepta `name` y lanza ante respuesta sin `name`.
- [x] GREEN `apps/web/src/modules/chat/voice/liveTokenRequest.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/live-events.test.ts` — `setupComplete`, audio `inlineData` (24 kHz), `inputTranscription`/`outputTranscription`, `interrupted`, `turnComplete`, `toolCall`, `toolCallCancellation`, `sessionResumptionUpdate`, `goAway`, mensaje inválido → `unknown` sin excepción, y un mensaje que produce varios eventos.
- [x] GREEN `apps/web/src/modules/chat/voice/liveEvents.ts`.
- [x] RED `apps/__tests__/web/modules/chat/voice/pcm.test.ts` — downsample de 48k→16k conservando longitud y amplitud, ida y vuelta PCM16↔float32, base64 con framing correcto.
- [x] GREEN `apps/web/src/modules/chat/voice/pcm.ts`.
- [x] RED `apps/__tests__/web/integrations/chat-prompt-channel.test.ts` — `BASE_CHAT_RULES` byte-idéntico al texto actual (string esperado fijado en el test) y **con** `[SUGGESTIONS]`; `VOICE_CHAT_RULES` **sin** `[SUGGESTIONS]` ni bloque JSON de `payload`; `assembleChatSystemPrompt({ channel: "voice" })` sin el bloque y sin `channel` con el mismo `systemContent` que hoy.
  - Nota: la aserción `no payload` se acotó a `"payload"` (el bloque JSON). `CORE_RULES` (líneas 6-21, byte-idéntico) menciona `payload.id` en la regla anti-alucinación; prohibir la palabra suelta rompería el byte-lock del chat de texto.
- [x] GREEN `apps/web/src/integrations/chat/knowledge/staticKnowledge.ts` (partir en `CORE_RULES` + `SUGGESTIONS_RULES` + `VOICE_OUTPUT_RULES`) y `promptAssembler.ts` (parámetro `channel`, default `"text"`).
- [x] RED `apps/__tests__/web/integrations/gemini-schema.test.ts` — mapeo JSON Schema → Gemini: `string/number/boolean/array/object`, `enum`, anidados, `properties` vacío, tipo desconocido → `STRING`.
- [x] GREEN `apps/web/src/integrations/chat/tools/geminiSchema.ts` — extracción pura de `toGeminiType`/`toGeminiSchema` desde `GeminiChatProvider.ts`, importada por el provider **sin cambio de comportamiento**.
- [x] RED `apps/__tests__/web/modules/chat/voice/voice-session-state.test.ts` — transiciones completas, reconexión solo si es resumible, cierre por tope de duración, error terminal tras dos reconexiones fallidas.
- [x] GREEN `apps/web/src/modules/chat/voice/voiceSessionState.ts`.
- [x] REFACTOR — suite en verde, sin cambio de comportamiento.

## Fase 2 · Rutas (TDD)

- [x] RED `apps/__tests__/web/routes/chat-voice-config-route.test.ts` — `401` sin sesión, `{ enabled: false }` con el flag apagado, `{ enabled: true, model, maxSessionMinutes }` encendido.
- [x] RED `apps/__tests__/web/routes/chat-voice-token-route.test.ts` — `401` sin sesión, `503` con la feature apagada **sin llamar a Google**, `429` al superar el cupo, `200` con `{ token, model, expiresAt }` y `uses: 1` cuando todo está bien; error de Google → `502`.
- [x] GREEN `apps/web/src/app/api/chat/voice/config/route.ts` y `apps/web/src/app/api/chat/voice/token/route.ts`.
- [x] RED `apps/__tests__/web/routes/chat-voice-tool-route.test.ts` — puente de tools: `401` sin sesión, `503` apagada, `403` con una tool mutating (`enqueue_meeting`, `manage_meeting_share`) **sin ejecutarla**, `200` con `{ result }` para una tool de lectura, `500` si la tool lanza sin filtrar el error interno.
- [x] GREEN `apps/web/src/app/api/chat/voice/tool/route.ts` — valida contra `READ_ONLY_TOOLS` y ejecuta en el servidor (el browser nunca ejecuta tools).
- [x] Verificar que el prompt y las tools se arman con `assembleChatSystemPrompt` + `buildUserContext` + `READ_ONLY_TOOLS` (ninguna tool mutating en el payload) y que las declaraciones van con `behavior: "BLOCKING"`.
- [x] REFACTOR.

## Fase 3 · Cliente (validación por integración/manual)

- [x] `apps/web/src/components/chat/useVoiceSession.ts`: `getUserMedia`, AudioWorklet 16 kHz, envío `realtimeInput.audio`, playback 24 kHz, `interrupted` corta la reproducción, reconexión con token nuevo + handle.
- [x] Worklets `apps/web/public/worklets/pcm-capture.js` y `pcm-playback.js`.
- [x] Botón de micrófono y estado (escuchando / hablando / reconectando / error) en `ChatInput.tsx` y `ChatWidget.tsx`, oculto si `enabled` es `false`.
- [x] Persistencia de los turnos cerrados por `/api/chat/history` (mismo endpoint que el texto; no tocar `useChatStream`).
  - Nota: si el usuario envía un mensaje de texto después de un turno de voz en la misma sesión, el autosave de `useChatStream` (que solo conoce el historial de texto) reescribe `/api/chat/history` y puede pisar los turnos de voz. Es la consecuencia aceptada de no tocar `useChatStream`; se documenta como limitación conocida.
- [ ] Validación manual registrada: permiso concedido, permiso denegado, barge-in, corte de reconexión, tope de duración alcanzado.
  - **PENDIENTE**: sin navegador ni micrófono en este entorno. La implementación está completa; queda ejecutar la prueba manual (navegador real, AudioWorklet, permiso denegado, barge-in, reconexión y tope).

## Fase 4 · Cierre

- [x] Env en `README.md` + `.env.development.example` + `.env.production.example` (`VOICE_CHAT_ENABLED`, `GEMINI_LIVE_MODEL`, `VOICE_CHAT_MAX_SESSION_MINUTES`).
- [x] Aviso de privacidad en la UI antes de pedir el micrófono + nota en el README.
- [x] `bun run test`, `bun run lint`, `bun run typecheck` en verde.
- [ ] Validar contra los criterios de aceptación de `spec.md`.
  - **PENDIENTE**: los criterios verificables por tests están cubiertos; los que dependen de audio real (sesión devuelve audio + transcripción en vivo, reconexión a los ~10 min) quedan sujetos a la validación manual de Fase 3.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
  - **PENDIENTE**: no se mueve hasta ejecutar la validación manual (Fase 3).
