# Diseño: Alineación del Soporte de Chat (011)

## Enfoque técnico

Dos PRs secuenciales, ambos cambios de contenido/UI solo en web más un export compartido de dominio. Sin
cambios de schema, migración o contrato de despliegue. El PR-A hace autoconsistente la UX de soporte
(ubicación del botón + copy en español + respuesta de Soporte). El PR-B actualiza el conocimiento del
asistente para los deltas de 009/010 y corrige de raíz el enum de estados de `search_meetings` (única
fuente de verdad en `packages/shared`).

## PR-A — Botón + copy

### Mecanismo de visibilidad (revisado durante el apply — ver abajo)

Diseño inicial (superado): un callback `onSupportTopic?: () => void` disparado solo por la tarjeta de
Soporte, que invertía una flag local `showBugReport` `useState(false)` en `ChatWidget.tsx`. **Rechazado
durante la implementación**: la revisión acotada obligatoria post-apply (R3 Reliability) encontró que el
estado efímero no sobrevive la restauración de historial desde localStorage/DB de `useChatStream` al
montar — después de una recarga, la respuesta de Soporte restaurada (que le dice al usuario que el botón
está justo debajo) se renderizaría sin ningún botón, una regresión respecto del renderizado incondicional
previo al PR.

**Mecanismo shippeado** — visibilidad derivada del contenido de los mensajes, no del estado del componente:

- El nuevo `apps/web/src/components/chat/chatWidget.logic.ts` exporta `SUPPORT_TOPIC_MARKER = "Reportar un
  problema"` y `hasSupportTopicMarker(messages): boolean` — un chequeo `.some()` puro que busca un mensaje
  con rol de asistente que contenga ese substring literal (el mismo texto que renderiza la respuesta de
  Soporte, así que está presente exactamente en el contenido restaurado/cacheado).
- `ChatWidget.tsx`: `const showBugReport = hasSupportTopicMarker(messages) || manualReveal;` — sin
  callback `onSupportTopic`, sin campo `isSupport` en `STARTER_TOPICS`; ambos se eliminaron por
  innecesarios una vez que la visibilidad pasó a derivarse del contenido.
- **Vía de escape manual** (`manualReveal`, agregada después de que una segunda pasada de revisión
  marcara un gap de R4 Resilience): una conversación restaurada cuyo historial nunca llegó a Soporte no
  tiene ninguna forma de revelar el botón sin resetear (perdiendo el historial). Un pequeño link siempre
  visible, "¿Necesitás reportar un problema?", junto a "Nueva conversación", setea una flag local
  `manualReveal` (con alcance de sesión, sin necesidad de backend) que se combina con OR en
  `showBugReport`. El camino derivado del contenido sigue autorrecuperándose al restaurar; esto es
  puramente un camino manual adicional, así que no reintroduce el bug original de restauración.
- `chatWidget.logic.ts` lleva un comentario `ponytail:` sobre el tradeoff del acoplamiento por string; la
  respuesta de Soporte en `ChatMessages.tsx` lleva un comentario recíproco que fija el substring exacto del
  que depende `SUPPORT_TOPIC_MARKER`.

### Posición de renderizado (post-move)

Se eliminó el bloque incondicional que antes estaba al final del panel. Se renderiza condicionalmente
justo debajo del área de mensajes, antes del banner de error, de modo que el botón queda visualmente
debajo de la respuesta de Soporte:

```tsx
{showBugReport && (
  <div className="flex justify-center pb-2"><ReportBugButton /></div>
)}
```

### Comportamiento del reset

`handleReset` limpia `manualReveal` y llama a `reset()`. Reset → mensajes limpiados → vuelve el estado
inicial de `STARTER_TOPICS` (se renderiza cuando `messages.length === 0`); `hasSupportTopicMarker([])` es
`false`, así que el camino derivado también descarta el botón. Nada tiene alcance de sesión más allá de
`manualReveal`; cerrar el panel mantiene el estado (aceptado según la decisión del grill).

### Las 9 traducciones de strings (voseo)

`ReportBugButton.tsx` (6): "Report a bug" → **"Reportar un problema"** (canónico, CONTEXT.md); "Describe
what happened..." → "Contanos qué pasó..."; aria-label "Bug report message" → "Mensaje del reporte";
"Submitting..." → "Enviando..."; "Submit report" → "Enviar reporte"; "Cancel" → "Cancelar".

`reportBugButton.logic.ts` (3): "This report has no meeting diagnostic log." → "Este reporte no incluye el
diagnóstico de una reunión."; "Bug report submitted. Thank you." → "Reporte enviado. ¡Gracias!"; "Unable to
submit bug report." → "No pudimos enviar el reporte."

Nota: `MeetingDetailsView.tsx` reutiliza `ReportBugButton` (con `meetingId`) — hereda las strings en
español; no hay cambio por-uso.

### Respuesta prearmada de Soporte + línea de corpus

- `ChatMessages.tsx` respuesta de Soporte en STARTER_TOPICS: eliminar el párrafo "Próximamente";
  reemplazarlo con copy que afirme que el camino de reporte ya existe: apretar "Reportar un problema"
  debajo de esta respuesta para enviar el problema directo al canal de soporte.
- `documentCorpus.ts`: agregar un doc chico `support-report-problem` (tags: soporte, reporte, problema,
  bug) que le enseñe al asistente: para escalar, abrir el topic Soporte y apretar "Reportar un problema";
  el reporte va al canal de soporte del equipo.

## PR-B — Conocimiento + enum

### Export de la lista canónica de estados

Invertir la fuente en `packages/shared/src/domain/meetingStatus.ts`: definir un array `as const` y
derivar la unión a partir de él — la unión entonces no puede desalinearse de la lista, y todo
`Record<MeetingStatus, ...>` existente sigue siendo chequeado exhaustivamente por el compilador:

```ts
export const MEETING_STATUSES = ["pending", "joining", "waiting_admission", "recording",
  "transcribing", "summarizing", "completed", "admission_timeout", "rejected",
  "error", "transcription_error"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
```

| Opción | Tradeoff | Decisión |
|---|---|---|
| Array `as const` → derivar la unión | El array es la SSOT; se preserva la exhaustividad a nivel de tipo | **Elegida** |
| `Object.keys(MEETING_STATUS_LABELS_ES)` | Solo en runtime; el record de labels es privado; pierde el tipado de tupla | Rechazada |
| Mantener la unión, mantener el array a mano | Exactamente la desalineación que esto corrige | Rechazada |

Consumo en `definitions.ts` (`searchMeetingsTool`): `enum: [...MEETING_STATUSES]` (spread — el campo del
JSON-schema es un `string[]` mutable). Los imports desde `@meeting-bot/shared/domain/meetingStatus` ya
existen.

### Ediciones de corpus/topic (solo deltas de 009/010)

- Doc `meeting-lifecycle`: agregar `transcription_error` — recuperable, grabación conservada, se reintenta
  desde el detalle sin re-unirse.
- Doc `troubleshooting-transcription`: mencionar el estado `transcription_error` y el camino de
  regeneración.
- Doc nuevo `meeting-access-sharing` (009 + ADR-0007): vocabulario "dar acceso"/"acceso" (nunca "Access
  Grant" en la copy); "enlace de acceso restringido" por email es el único tipo de compartido (sin
  enlaces públicos); sugerencias por asistente en reuniones de calendario; bloqueo por owner desactivado;
  los co-asistentes de reuniones de auto-join reciben acceso automáticamente.
- Respuestas de STARTER_TOPICS cambiadas: **"Dashboard y reuniones"** (reemplazar "link público o
  restringido por email" por la redacción de acceso por email restringido; agregar `transcription_error` a
  la lista de estados) y **"Cómo funciona el sistema"** (agregar una nota de recuperación de
  `transcription_error` al flujo). Soporte se corrigió en el PR-A; los demás topics quedan sin tocar.

## Cambios de archivos

| Archivo | PR | Acción |
|---|---|---|
| `apps/web/src/components/chat/ChatWidget.tsx` | A | visibilidad derivada, vía de escape de revelado manual, renderizado condicional, handleReset |
| `apps/web/src/components/chat/chatWidget.logic.ts` | A | `SUPPORT_TOPIC_MARKER`, `hasSupportTopicMarker` (nuevo) |
| `apps/__tests__/web/components/chat/chat-widget.logic.test.ts` | A | tests unitarios de la derivación (nuevo) |
| `apps/web/src/components/chat/ChatMessages.tsx` | A+B | A: respuesta de Soporte + comentario del marcador; B: 2 respuestas de topic |
| `apps/web/src/components/bug-report/ReportBugButton.tsx` | A | 6 strings |
| `apps/web/src/components/bug-report/reportBugButton.logic.ts` | A | 3 strings |
| `apps/__tests__/web/components/report-bug-button.logic.test.ts` | A | afirmaciones de literales en español (primero-el-test) |
| `apps/web/src/integrations/chat/knowledge/documentCorpus.ts` | A+B | A: 1 doc; B: 2 ediciones + 1 doc |
| `packages/shared/src/domain/meetingStatus.ts` | B | export `MEETING_STATUSES`, unión derivada |
| `apps/web/src/integrations/chat/tools/definitions.ts` | B | enum desde la lista compartida |
| `apps/__tests__/shared/domain/meeting-status.test.ts` | B | Crear (primero-el-test) |
| `apps/__tests__/web/integrations/chat-tools-definitions.test.ts` | B | afirmación del enum |

## Estrategia de testing

| Capa | Qué | Enfoque |
|---|---|---|
| Unitario (PR-A, RED primero) | `reportBugButton.logic.ts` devuelve strings en español | Actualizar las afirmaciones de literales antes de traducir |
| Unitario (PR-B, RED primero) | `MEETING_STATUSES` contiene los 11 estados incl. `transcription_error`; la búsqueda de label funciona para cada miembro del array | Nuevo `apps/__tests__/shared/domain/meeting-status.test.ts` |
| Unitario (PR-B, RED primero) | `searchMeetingsTool.parameters.properties.status.enum` es igual a `MEETING_STATUSES` | Extender `chat-tools-definitions.test.ts` |
| Unitario (PR-A, agregado tras la revisión) | `hasSupportTopicMarker` — lista vacía, marcador restaurado, filtrado por rol, casos sin marcador | `apps/__tests__/web/components/chat/chat-widget.logic.test.ts` |
| Visual (excepción) | El botón se renderiza tras el click en Soporte o al restaurar; la vía de escape manual lo revela; se limpia en el reset | Manual — según la excepción de UI puramente visual de AGENTS.md; no existen tests de componente para esta área |

## Matriz de amenazas

N/A — sin routing, shell, subproceso, automatización de VCS/PR, clasificación de archivos ejecutables, ni
límite de integración de procesos.

## Migración / Rollout

Sin migración. Dos PRs secuenciales a `dev`, cada uno dentro del presupuesto de 400 líneas; revert =
revertir el commit del PR. Se acepta la ventana de gap del corpus entre PRs (el PR-A es autoconsistente).

## Preguntas abiertas

Ninguna — todas las decisiones de shaping quedaron resueltas en la sesión de grill vinculante.
