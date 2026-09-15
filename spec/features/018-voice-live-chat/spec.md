# 018 · Voz en tiempo real en el chat (Gemini Live)

**Estado:** en curso

## Qué hace

En el chat del dashboard aparece un botón de micrófono. El usuario habla y el asistente le responde
**por voz**, con la transcripción de ambos lados apareciendo en vivo en la misma conversación de
siempre — el mismo hilo que se ve al recargar la página.

La conversación de voz usa **el mismo cerebro que el chat de texto**: el corpus documental, el
contexto del usuario (rol admin/member) y las **mismas herramientas de solo lectura** sobre sus
reuniones. Nada de un asistente paralelo con otra memoria.

Es una capacidad **opt-in**: viene apagada y se enciende por variable de entorno.

## Por qué

1. **Valor de producto inmediato**: consultar "¿qué se decidió en la reunión del martes?" caminando
   entre reuniones no se puede hacer escribiendo. Manos libres es la diferencia entre una herramienta
   que se consulta y una que acompaña.
2. **Reutiliza lo caro que ya está construido**: el ensamblado de prompt (`promptAssembler`) y las
   tools del chat ya existen y están testeados; la voz solo añade el transporte de audio. El coste
   incremental es transporte, no inteligencia.
3. **Es la fundación verificable de la 019**: el ciclo de vida de sesión Live (token efímero, PCM,
   reconexión con `sessionResumption`, transcripciones) queda probado contra la API real en un
   contexto de riesgo bajo. La transcripción en vivo de reuniones (019) reutiliza exactamente este
   transporte.

## Criterios de aceptación

- [ ] Con `VOICE_CHAT_ENABLED` ausente o `false` (default), el botón de voz no se muestra y
      `POST /api/chat/voice/token` responde `503` sin llamar a Google.
- [ ] La API key de Gemini **nunca** llega al navegador: el token efímero se mintea en el servidor
      con `uses: 1`, y la `systemInstruction` y las tools viajan **fijadas dentro del token**; el
      cliente abre la sesión con `setup: {}`.
- [ ] La sesión devuelve audio del asistente y transcripción en vivo de ambos lados; el usuario ve su
      texto y el del asistente en el chat.
- [ ] La conversación de voz se persiste en el historial del chat y sigue ahí tras recargar.
- [ ] Ante la caída de conexión (~10 min), el cliente reconecta con token nuevo + handle de
      `sessionResumption` sin perder el hilo; hay un tope de duración configurable que cierra la
      sesión con aviso visible.
- [ ] Rate limit por usuario: superado el cupo, `POST /api/chat/voice/token` responde `429` y la UI
      lo dice con un mensaje claro, sin romper la sesión de texto.
- [ ] Sin sesión autenticada, `GET /api/chat/voice/config` y `POST /api/chat/voice/token` responden `401`.
- [ ] Por voz solo pueden ejecutarse tools de **lectura**: ninguna tool mutating está disponible.
- [ ] `bun run test`, `bun run lint` y `bun run typecheck` pasan en verde.

## Fuera de alcance

- **Transcripción en vivo de la reunión** (captions durante la grabación) → feature **019**, que
  reutiliza este transporte pero vive en el worker.
- **Bot que habla dentro de la reunión** (participante activo) — riesgo y coste de salida alto
  (`$0.018/min`); no se aborda aquí.
- Video/cámara, *wake word*, voces TTS personalizadas, voz en la extensión de Chrome, y ejecución de
  tools mutating (`enqueue_meeting`, `manage_meeting_share`) por voz.
- Cambios en el pipeline batch de transcripción/resumen (spec 017): esta feature es **aditiva**.
