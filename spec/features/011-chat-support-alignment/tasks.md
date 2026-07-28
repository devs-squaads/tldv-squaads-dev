# Tareas: Alineación del Soporte de Chat

## Pronóstico de carga de revisión

| Campo | Valor |
|-------|-------|
| Líneas cambiadas estimadas | PR-A ~90-150 (mayormente ediciones de string-literals + 1 flag + 1 doc de corpus); PR-B ~140-200 (1 refactor de tipo + 1 wiring de enum + 3 ediciones de corpus + 1 doc nuevo + 2 respuestas de topic); total ~230-350 entre ambos PRs |
| Riesgo del presupuesto de 400 líneas | Bajo — cada PR está independientemente muy por debajo de 400; impulsado por ediciones de literales/copy, no lógica nueva |
| Se recomiendan PRs encadenados | Sí — ya es vinculante según la estructura de PR decidida río arriba, no un disparador por riesgo de tamaño |
| División sugerida | PR-A (ubicación del botón + copy en español) → PR-B (corpus de conocimiento + enum de estados), ambos desde `dev` |
| Estrategia de entrega | ask-on-risk |
| Estrategia de cadena | stacked-to-main — el PR-A y el PR-B se ramifican cada uno desde `dev` y vuelven a mergearse en `dev` en secuencia; el PR-B solo necesita que el PR-A esté mergeado primero por consistencia del corpus (respuesta de Soporte), no una dependencia de rama-sobre-rama |

Decisión necesaria antes del apply: No — la estructura de PRs y los nombres de rama ya son vinculantes;
ambas porciones pronostican riesgo Bajo, así que no hace falta ninguna otra elección de estrategia de
cadena.
Se recomiendan PRs encadenados: Sí
Estrategia de cadena: stacked-to-main
Riesgo del presupuesto de 400 líneas: Bajo

### Unidades de trabajo sugeridas

| Unidad | Objetivo | PR probable | Comando de test focalizado | Harness en runtime | Límite de rollback |
|---|---|---|---|---|---|
| 1 | Flag `showBugReport` + reubicación del botón + copy en español voseo + fix de la respuesta/corpus de Soporte | PR-A (`feat/011-01-report-button-soporte`) | `bun test apps/__tests__/web/components/report-bug-button.logic.test.ts` | Manual: abrir el panel, hacer click en la tarjeta de Soporte, confirmar que el botón aparece debajo de la respuesta y que el reset lo limpia (excepción de TDD visual-UI, AGENTS.md) | Revertir `ChatWidget.tsx`, `ChatMessages.tsx`, `ReportBugButton.tsx`, `reportBugButton.logic.ts`, `documentCorpus.ts` (1 doc), el test de lógica |
| 2 | Export canónico `MEETING_STATUSES` + consumo del enum en `searchMeetingsTool` + actualización del corpus 009/010 | PR-B (`feat/011-02-chat-knowledge-refresh`) | `bun test apps/__tests__/shared/domain/meeting-status.test.ts apps/__tests__/web/integrations/chat-tools-definitions.test.ts` | Manual: preguntarle al asistente "¿por qué mi reunión tiene error de transcripción?" y "¿cómo comparto una reunión?"; confirmar que las respuestas coinciden con la realidad de 009/010 (sin link público, transcription_error es recuperable) | Revertir `meetingStatus.ts`, `definitions.ts`, `documentCorpus.ts` (2 ediciones + 1 doc), `ChatMessages.tsx` (2 respuestas), los archivos de test nuevos |

---

## Fase A1: Wiring de ubicación del botón (PR-A)

> **Revisado durante la implementación.** A1.1-A1.5 originalmente shippearon un callback `onSupportTopic`
> + flag `isSupport` + mecanismo `useState` (como en el draft inicial de plan.md). La revisión acotada
> obligatoria post-apply (R3 Reliability) encontró que ese mecanismo no sobrevivía la restauración de
> historial de `useChatStream` al recargar — una regresión real respecto del renderizado incondicional
> previo al PR. Se reemplazó por visibilidad derivada del contenido antes de mergear; el
> callback/flag/campo-de-datos se eliminaron por completo. Los checkboxes de abajo describen el mecanismo
> realmente shippeado.

- [x] A1.1 Nuevo `apps/web/src/components/chat/chatWidget.logic.ts`: exporta `SUPPORT_TOPIC_MARKER = "Reportar un problema"` y `hasSupportTopicMarker(messages): boolean` (`.some()` puro sobre mensajes con rol de asistente que contienen el marcador).
- [x] A1.2 `ChatWidget.tsx`: `const showBugReport = hasSupportTopicMarker(messages) || manualReveal;` — sin prop de callback pasada a `<ChatMessages>`, sin campo `isSupport` en `STARTER_TOPICS`.
- [x] A1.3 `apps/__tests__/web/components/chat/chat-widget.logic.test.ts` (nuevo, TDD-obligatorio): 4 casos — lista vacía, marcador restaurado en asistente, marcador en rol de usuario (falso por filtrado de rol), asistente sin marcador.
- [x] A1.4 `ChatWidget.tsx`: eliminar el bloque incondicional `<ReportBugButton />`; renderizarlo condicionalmente (`{showBugReport && (...)}`) justo debajo del área de mensajes, antes del banner de error.
- [x] A1.5 `ChatWidget.tsx`: `handleReset` llama a `reset()`; la visibilidad derivada resuelve naturalmente a oculta una vez que `messages` está vacío.
- [x] A1.6 Verificación manual (excepción visual según AGENTS.md): el estado inicial oculta el botón; el click en Soporte lo revela debajo de la respuesta; un hilo de solo texto libre nunca lo muestra; el reset vuelve a los topics iniciales con el botón oculto; **una recarga de página con un historial restaurado que contiene Soporte muestra el botón de nuevo** (la regresión que corrige esta revisión). Verificado mediante trazado de código a través de `ChatWidget.tsx`/`ChatMessages.tsx`/`useChatStream.ts`; se recomienda un click-through humano rápido antes de mergear.
- [x] A1.7 (agregado tras el hallazgo de R4 Resilience) `ChatWidget.tsx`: estado `manualReveal` + un link persistente "¿Necesitás reportar un problema?" junto a "Nueva conversación", mostrado cuando `messages.length > 0 && !showBugReport`; `handleReset` lo limpia. Cierra el gap donde una conversación restaurada sin el marcador no tenía ninguna vía para alcanzar el botón excepto perder el historial vía reset.

## Fase A2: Copy en español voseo (TDD-obligatorio)

- [x] A2.1 RED: actualizar las afirmaciones de `apps/__tests__/web/components/report-bug-button.logic.test.ts` a los literales en voseo (ej. `"This report has no meeting diagnostic log."` → `"Este reporte no incluye el diagnóstico de una reunión."`; `"Unable to submit bug report."` → `"No pudimos enviar el reporte."`). Correrlo — confirmar que falla contra las strings en inglés actuales.
- [x] A2.2 GREEN: `reportBugButton.logic.ts` — traducir las 3 strings (fallback de `getBugReportModeNote`; éxito de `resolveBugReportFeedback` `"Bug report submitted. Thank you."` → `"Reporte enviado. ¡Gracias!"`; fallback de error). Volver a correr A2.1, confirmar verde.
- [x] A2.3 `ReportBugButton.tsx`: traducir las 6 strings de UI — "Report a bug" → **"Reportar un problema"** (canónico); "Describe what happened..." → "Contanos qué pasó..."; aria-label "Bug report message" → "Mensaje del reporte"; "Submitting..." → "Enviando..."; "Submit report" → "Enviar reporte"; "Cancel" → "Cancelar". Sin cambio de test (ningún test de lógica cubre este archivo — excepción visual).

## Fase A3: Respuesta de Soporte + línea de corpus

- [x] A3.1 Respuesta de Soporte en STARTER_TOPICS de `ChatMessages.tsx`: eliminar el párrafo "Próximamente"; reemplazarlo con copy que afirme que el botón "Reportar un problema" (visible justo debajo) envía el problema directo al canal de soporte ahora.
- [x] A3.2 `documentCorpus.ts`: agregar un doc nuevo `support-report-problem` (tags: soporte, reporte, problema, bug) — escalar vía el topic Soporte → "Reportar un problema" → va al canal de soporte del equipo; NO afirmar que está próximo.

## Fase A4: Verificación (PR-A)

- [x] A4.1 `bun test apps/__tests__` en verde; confirmar que no queda ningún literal en inglés en `reportBugButton.logic.ts`/`ReportBugButton.tsx`/su test.
- [x] A4.2 `bun run lint && bun run typecheck`.
- [x] A4.3 Recorrido manual según A1.6; confirmar que `git diff --stat dev` se mantiene por debajo de 400 líneas antes de abrir el PR-A.

---

## Fase B1: Lista canónica de estados (TDD-obligatorio)

- [ ] B1.1 RED: crear `apps/__tests__/shared/domain/meeting-status.test.ts` afirmando que `MEETING_STATUSES` contiene los 11 estados incl. `"transcription_error"`, y que `getMeetingStatusLabel` resuelve un label para cada miembro del array. Correrlo — confirmar que falla (`MEETING_STATUSES` todavía no existe).
- [ ] B1.2 GREEN: `packages/shared/src/domain/meetingStatus.ts` — invertir la fuente: `export const MEETING_STATUSES = [...] as const;` y luego `export type MeetingStatus = (typeof MEETING_STATUSES)[number];`, reemplazando la unión escrita a mano. Volver a correr B1.1, confirmar verde; confirmar que `ALLOWED_TRANSITIONS`/`MEETING_STATUS_LABELS_ES` siguen tipando como `Record<MeetingStatus, ...>` exhaustivos.

## Fase B2: Consumo del enum en search_meetings (TDD-obligatorio)

- [ ] B2.1 RED: extender `apps/__tests__/web/integrations/chat-tools-definitions.test.ts` con un caso que afirme que `searchMeetingsTool.parameters.properties.status.enum` es igual a `[...MEETING_STATUSES]` (import desde `@meeting-bot/shared/domain/meetingStatus`). Correrlo — confirmar que falla (el array hardcodeado actual omite `transcription_error`).
- [ ] B2.2 GREEN: `definitions.ts` — importar `MEETING_STATUSES`; reemplazar el array hardcodeado `status.enum` por `enum: [...MEETING_STATUSES]`. Volver a correr B2.1, confirmar verde.

## Fase B3: Actualización de corpus/STARTER_TOPICS (solo deltas de 009/010)

- [ ] B3.1 Doc `meeting-lifecycle` de `documentCorpus.ts`: agregar `transcription_error` — recuperable, grabación conservada, se reprocesa desde el storage sin re-unirse.
- [ ] B3.2 Doc `troubleshooting-transcription` de `documentCorpus.ts`: mencionar el estado `transcription_error` y el camino de reprocesamiento/regeneración.
- [ ] B3.3 `documentCorpus.ts`: agregar doc nuevo `meeting-access-sharing` (009 + ADR-0007) — vocabulario "dar acceso"/"acceso" (nunca "Access Grant"); "enlace de acceso restringido" por email como único tipo de compartido (sin enlaces públicos); sugerencias por asistente en reuniones de calendario; bloqueo por owner desactivado; los co-asistentes de reuniones de auto-join reciben acceso automáticamente.
- [ ] B3.4 Respuesta "Dashboard y reuniones" de STARTER_TOPICS en `ChatMessages.tsx`: reemplazar "link público o restringido por email" por la redacción de acceso exclusivamente por email restringido; agregar `transcription_error` a la lista de estados.
- [ ] B3.5 Respuesta "Cómo funciona el sistema" de STARTER_TOPICS en `ChatMessages.tsx`: agregar una nota de recuperación de `transcription_error` al flujo.

## Fase B4: Verificación (PR-B)

- [ ] B4.1 `bun test apps/__tests__` en verde (archivos de test nuevos + actualizados).
- [ ] B4.2 `bun run lint && bun run typecheck`.
- [ ] B4.3 Recorrido manual: preguntar "¿cómo comparto una reunión?" (solo email restringido, sin link público) y sobre `transcription_error` (explicación de que es recuperable); confirmar que `git diff --stat dev` se mantiene por debajo de 400 líneas antes de abrir el PR-B.
