# 007 · Sincronización de estados de la extensión — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

Centralizar el polling de estado en el service worker de la extensión (una única fuente de verdad que difunde `MEETING_UPDATE` a widget y popup), hacer el render del widget idempotente (solo re-renderizar ante cambio real de estado) y adaptar el intervalo de polling a la fase del meeting. Sin cambios de backend: se mantiene el contrato HTTP actual (`/api/v1/extension/meetings/*`), lo que deja el camino preparado para un canal push futuro sin re-arquitectura.

## Implementación

1. Extraer la lógica de decisión de estado del widget (¿cambió el estado?, ¿toca re-render?) a un módulo puro testeable — `apps/extension/src/content/widget.ts` → nuevo `apps/extension/src/shared/statusSync.ts`.
2. `setState` con chequeo de igualdad y render que preserva el drag en curso — `apps/extension/src/content/widget.ts`.
3. Loop de polling único en background con difusión `MEETING_UPDATE` a tabs y popup; widget y popup pasan a ser suscriptores (eliminan sus `setInterval` propios) — `apps/extension/src/background/service-worker.ts`, `content/widget.ts`, `popup/popup.ts`.
4. Intervalo adaptativo: 2 s en fases transitorias (`pending`/`joining`/`waiting_admission`), 5 s en el resto — `apps/extension/src/shared/constants.ts` + scheduler en `statusSync.ts`.
5. Regenerar el ZIP interno (`bun run extension:build`) y actualizar `docs/extension.md` con la nueva arquitectura de estados.

## Decisiones

- **Polling centralizado antes que SSE** — resuelve la desincronización y la carga duplicada sin tocar la web ni la infraestructura; SSE queda como evolución en backlog. Se descartó ir directo a SSE por esfuerzo y porque el dolor actual es de coordinación cliente, no de transporte.
- **Lógica de estado en módulo puro** — la extensión no tiene harness de DOM para tests; extraer la decisión (comparación de estados, cadencia, dedupe) permite TDD real con el runner de Bun en `apps/__tests__/extension/`.
- **Mantener `REQUEST_TIMEOUT_MS=10s`** — el problema no es el timeout sino los ticks descartados; el scheduler nuevo reintenta al ciclo siguiente tras un timeout sin quedar bloqueado.

## Riesgos

- **MV3 suspende el service worker** — un `setInterval` en background puede morir con el worker. Mitigación: `chrome.alarms` como tick base mientras exista un meeting activo, o keepalive por puerto abierto desde el content script.
- **Regresión de UX del widget (drag/posición)** — cubierto por criterio de aceptación explícito y validación manual en Meet real documentada en `tasks.md`.
