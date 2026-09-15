# 018 · Voz en tiempo real en el chat (Gemini Live) — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

**Cliente-a-servidor con token efímero restringido.** El servidor (Next.js, ya autenticado por
NextAuth) mintea un token de vida corta y de un solo uso que lleva **fijadas** la configuración del
modelo, la `systemInstruction` y las declaraciones de tools. El browser abre el WebSocket
**directamente contra Google** usando ese token: el audio no atraviesa nuestra infraestructura (mejor
latencia y mejor postura de privacidad, porque no lo proxeamos ni lo almacenamos) y la API key nunca
sale del servidor.

Se descarta proxear el WebSocket por el backend: la web se despliega en Vercel
(`apps/web/vercel.json`) y mantener una conexión viva por función es frágil y añade un salto de red a
un flujo que es, por definición, sensible a latencia.

Toda la variación de proveedor vive detrás de un módulo de política y un constructor de payload
puros; el resto es transporte.

**Dos sockets con dos modelos.** La conversación la lleva `gemini-3.8-live`; la transcripción en vivo
de la voz del usuario la lleva `gemini-3.5-transcribe-live`, porque `gemini-3.8-live` **no** entrega
la transcripción de entrada (verificado). Ambos se autentican con el mismo mecanismo de token
efímero restringido: el servidor mintea uno por socket con la config fijada. Es también el transporte
exacto que necesitará la 019.

## Protocolo verificado contra la API real (2026-09-15)

> No es de memoria ni de la documentación: se ejecutó contra `generativelanguage.googleapis.com` con
> una key real. **La doc oficial miente en un punto** y esto lo ahorra en implementación.

| Paso | Forma verificada |
|---|---|
| Mintear token | `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens`, header `x-goog-api-key`, body `{ uses: 1, expireTime, newSessionExpireTime, bidiGenerateContentSetup: {...} }` |
| ⚠️ Campo de restricción | Es **`bidiGenerateContentSetup`**. `liveConnectConstraints` (el nombre que publica la doc) devuelve `400 Unknown name` |
| Contenido restringido | `{ model: "models/gemini-3.8-live", generationConfig: { responseModalities: ["AUDIO"] }, systemInstruction: { parts: [{ text }] }, tools: [{ functionDeclarations: [...] }] }` |
| WebSocket | `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<name completo auth_tokens/…>` |
| Primer mensaje | `{ setup: {} }` — **vacío**. La config viene del token. Enviar cualquier otra cosa antes cierra con `1007 setup must be the first message and only the first` |
| Audio de entrada (conversación) | ⚠️ **`{ clientContent: { turns: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/pcm;rate=16000", data } }] }] } }`**. `realtimeInput.audio` y `realtimeInput.mediaChunks` **se ignoran en silencio** en `gemini-3.8-live` (verificado con voz real: sin error, sin transcripción, sin respuesta) |
| Cierre de turno | `{ clientContent: { turnComplete: true } }` — el cliente decide cuándo terminó de hablar el usuario |
| Transcripción del usuario | ⚠️ `inputAudioTranscription` se acepta en el setup pero **no emite eventos** en `gemini-3.8-live` (verificado, también con `languageCodes`). Se obtiene con un **segundo socket** `gemini-3.5-transcribe-live` (`responseModalities: ["TEXT"]`, `inputAudioTranscription: { languageCodes: [] }`) que sí consume `realtimeInput.audio` y emite `serverContent.inputTranscription.text` en vivo |
| Audio de entrada (transcripción) | `{ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } }` (funciona también `mediaChunks`); cerrar con `{ realtimeInput: { audioStreamEnd: true } }`. Este modelo **no** emite `turnComplete`: no hay que esperarlo. Verificado que **el mismo socket sirve para varios turnos** (dos turnos consecutivos transcritos en una sola sesión), así que no hace falta re-mintear token por turno |
| Texto de entrada | `{ realtimeInput: { text } }` |
| Eventos del servidor | `setupComplete`, `serverContent{ modelTurn.parts[].inlineData.data (PCM 24 kHz base64), inputTranscription.text, outputTranscription.text, interrupted, turnComplete, generationComplete, usageMetadata }`, `toolCall.functionCalls[]`, `toolCallCancellation`, `sessionResumptionUpdate{ resumable, newHandle }`, `goAway{ timeLeft }`. Se reciben además **mensajes vacíos `{}`** que hay que ignorar sin error |
| Respuesta de tool | `{ toolResponse: { functionResponses: [{ id, name, response }] } }` — verificado: el ciclo `toolCall → toolResponse → audio + transcripción` cierra |
| Modo de tool | Con el default **`NON_BLOCKING`** el turno hace `turnComplete` **antes** de que llegue el resultado y el asistente no llega a contestar. Con `behavior: "BLOCKING"` en la declaración, el modelo espera y responde en el mismo turno → **se usa `BLOCKING`** |
| ⚠️ Prompt hablado | Con las reglas del chat de texto, el modelo **lee en voz alta** el bloque `[SUGGESTIONS]` (verificado en una prueba real). En voz hay que usar reglas sin ese protocolo: `VOICE_CHAT_RULES` |
| Vida del token | **1 token = 1 conexión.** Reusarlo cierra con `1011 Token has been used too many times` |
| Reconexión larga | Mintear **token nuevo** y abrir con `{ setup: { sessionResumption: { handle }, contextWindowCompression: { slidingWindow: {} } } }` → verificado `setupComplete`. **No** poner `sessionResumption` ni `contextWindowCompression` en las restricciones del token: el servidor habilita la resumption por defecto (manda el handle igual) y esos campos los aporta el cliente en su `setup` |
| Límites de sesión | audio-only 15 min y conexión ~10 min; se gestionan con el tope de duración + reconexión con handle |

## Implementación

1. **Política (puro)** — `apps/web/src/modules/chat/voice/voicePolicy.ts`
   `resolveVoicePolicy(env)` → `{ enabled, model, maxSessionMinutes, rateLimit: { limit, windowMs }, reason }`.
   Default `enabled: false`; modelo default `gemini-3.8-live`; tope default 15 min.
2. **Minteo (puro + borde)** — `apps/web/src/modules/chat/voice/liveTokenRequest.ts`
   `buildLiveConnectConstraints({ model, systemInstruction, tools })` y
   `parseAuthTokenResponse(json)` (valida `name`, lanza si falta). El POST lo hace el route handler.
3. **Normalización de eventos (puro)** — `apps/web/src/modules/chat/voice/liveEvents.ts`
   `normalizeLiveServerMessage(raw)` → eventos tipados (`setup-complete`, `audio`, `input-transcript`,
   `output-transcript`, `interrupted`, `turn-complete`, `tool-call`, `tool-cancellation`,
   `resumption-update`, `go-away`, `error`, `unknown`). Un mensaje puede producir **varios** eventos
   (`modelTurn` con audio + texto + `turnComplete`). Entrada inválida → `unknown`, nunca excepción.
4. **PCM (puro)** — `apps/web/src/modules/chat/voice/pcm.ts`
   `downsampleTo16k`, `float32ToPcm16`, `pcm16ToBase64`, `base64ToPcm16`, `pcm16ToFloat32`.
   Capture a 16 kHz, playback a 24 kHz.
5. **Máquina de estados de sesión (puro)** — `apps/web/src/modules/chat/voice/voiceSessionState.ts`
   `idle → requesting-token → connecting → active(listening|speaking) → reconnecting → ended|error`,
   con reducer puro sobre los eventos de (3). Guarda: no reconectar si no hay `resumable`, no
   reconectar tras cerrar por tope de duración, `error` terminal tras dos reconexiones fallidas.
6. **Rutas** — `apps/web/src/app/api/chat/voice/config/route.ts` (GET, `{ enabled, model, maxSessionMinutes }`),
   `apps/web/src/app/api/chat/voice/token/route.ts` (POST). Ambas: `getServerSession` → `401`;
   gate de política → `503`; `consumeRateLimit` (ya existe en `@/integrations/sharing/rateLimit`) → `429`.
   El token route arma el prompt con `assembleChatSystemPrompt` + `buildUserContext` (los mismos del
   chat de texto) y usa `READ_ONLY_TOOLS`.
7. **Puente de tools** — `apps/web/src/app/api/chat/voice/tool/route.ts` (POST). El `toolCall` llega
   al **browser**, pero las tools viven en el servidor y usan `getServerSession()` internamente, así
   que el browser no puede ejecutarlas: la ruta recibe `{ name, args }`, valida que `name` esté en
   `READ_ONLY_TOOLS` (si no, `403` sin ejecutar), ejecuta `tool.execute(args)` y devuelve `{ result }`.
   El cliente reenvía el resultado por el WebSocket como `toolResponse`.
8. **Esquema de tools compartido** — extraer `toGeminiType`/`toGeminiSchema` de
   `apps/web/src/integrations/chat/GeminiChatProvider.ts` a
   `apps/web/src/integrations/chat/tools/geminiSchema.ts` (puro, con test), importado por el provider
   y por el constructor de restricciones de voz. Una sola copia del mapeo JSON Schema → Gemini.
9. **Cliente** — `apps/web/src/components/chat/useVoiceSession.ts` (getUserMedia, AudioWorklet,
   WebSocket, playback, reconexión) + `apps/web/public/worklets/pcm-capture.js` y `pcm-playback.js`
   + botón y estado en `ChatInput.tsx` / `ChatWidget.tsx`. La sesión de voz entrega los turnos
   cerrados al historial por la vía normal del chat: `appendMessages` de `useChatStream` (mismo estado
   que persiste el autosave, así el guardado del texto no pisa los turnos hablados).
10. **Env y docs** — `README.md` (tabla de variables) y `.env.development.example` /
    `.env.production.example`: `VOICE_CHAT_ENABLED`, `GEMINI_LIVE_MODEL`, `VOICE_CHAT_MAX_SESSION_MINUTES`.
11. **Tests** — `apps/__tests__/web/modules/chat/voice/*.test.ts` (política, constraints, eventos, PCM,
    máquina de estados), `apps/__tests__/web/routes/chat-voice-*.test.ts` (401/503/429/403/formas) y
    `apps/__tests__/web/integrations/gemini-schema.test.ts`, espejando el estilo de
    `chat-route.test.ts` y `chat-history-route.test.ts`.

## Decisiones

- **Sin dependencia nueva: `fetch` en vez de `@google/genai`** — el minteo es **un** POST y el resto es
  WebSocket crudo. Añadir `@google/genai@2.22.0` solo al servidor pagaría peso de dependencia por una
  llamada, y en el cliente metería el SDK en el bundle del navegador. El payload queda explícito y
  cubierto por tests. Verificado contra la API; si Google cambia el campo, falla ruidosamente en el test.
- **Cliente-a-servidor y no proxy** — ver Enfoque. Descartado: proxy WS en Next (Vercel, latencia, y
  haría pasar audio por nuestra infraestructura).
- **Config fijada en el token** — el prompt del sistema y las tools se quedan en el servidor; el
  cliente manda `setup: {}`. Descartado: mandar la config desde el browser (filtraría el prompt y
  permitiría a un cliente manipular tools).
- **Solo `READ_ONLY_TOOLS`** — por voz no se encola ni se comparte nada. Descartado: `ALL_TOOLS`; una
  instrucción hablada mal transcrita no debe ejecutar una mutación.
- **Tope de duración + reconexión con handle** — el tope evita el coste descontrolado
  (`$0.018/min` de audio de salida); el handle evita perder el hilo en el corte de ~10 min.
- **`sessionResumption` fuera de las restricciones** — verificado: con el handle mandado por el
  cliente la reconexión funciona con un token nuevo.
- **`behavior: "BLOCKING"` en las tools** — verificado que sin él (`NON_BLOCKING`, el default nuevo)
  el turno cierra antes del resultado y el asistente no contesta. Se prioriza un turno determinista
  por sobre la latencia de la respuesta asíncrona.
- **Puente de tools en el servidor** — el browser nunca ejecuta una tool: solo reenvía la llamada a
  una ruta autenticada que valida contra `READ_ONLY_TOOLS` y ejecuta en el servidor. Descartado:
  exponer ejecución de tools al cliente.
- **Prompt por canal (`channel: "text" | "voice"`)** — `BASE_CHAT_RULES` instruye a emitir un bloque
  `[SUGGESTIONS]` que el chat de texto parsea y borra; en voz nadie lo parsea y el modelo lo **dice en
  voz alta** (verificado). Se parte el texto en reglas comunes + reglas de canal, dejando
  `BASE_CHAT_RULES` **byte-idéntico** y añadiendo `VOICE_CHAT_RULES` sin el protocolo de sugerencias.
  Descartado: limpiar el texto a posteriori (el audio ya está generado) y descartado duplicar el
  prompt en el módulo de voz.
- **Lógica pura y testeable, UI exenta** — la constitución exime la UI visual; por eso el transporte
  se parte en módulos puros (eventos, PCM, estados) que sí se testean, y el enganche con
  `getUserMedia`/AudioWorklet se valida a mano.

## Riesgos

- **Privacidad: nuevo flujo de datos a Google** (audio del micrófono del usuario). Mitigación: opt-in
  por env (apagado por default), aviso en la UI antes de pedir el micrófono, y documentarlo en el
  README. Es un cambio de superficie de datos y debe revisarse explícitamente.
- **Coste** (~$0.023/min de conversación). Mitigación: tope de duración, rate limit por usuario, y
  free tier para desarrollo.
- **Dispositivos reales y permisos de micrófono** no se pueden validar en CI. Mitigación: los módulos
  puros sí están cubiertos por tests; queda **validación manual declarada** (navegador real, permiso
  concedido/denegado, barge-in, reconexión).
- **Deriva del protocolo** (el campo real ya difiere de la doc). Mitigación: `parseAuthTokenResponse`
  valida la respuesta y los tests fijan la forma verificada; un cambio rompe en CI, no en producción.
- **Regresión en el chat de texto.** Mitigación: la voz **no** toca `chatRuntimeCore`,
  `GeminiChatProvider` ni `useChatStream`; solo consume la ruta de historial ya existente.
