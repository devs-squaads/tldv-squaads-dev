# 007 · Sincronización de estados de la extensión — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._
_Orden TDD (RED → GREEN → REFACTOR): primero el test que falla, luego el código mínimo que lo pasa. Tests en `apps/__tests__/extension/` (ver `../../constitution/tech-stack.md` → Testing)._

- [x] RED: test de `statusSync.diff(prev, next)` — con estado idéntico devuelve patch vacío; con cambio de status devuelve `{attribute: "status", value: ...}`; con cambio de type devuelve patch completo. (`apps/__tests__/extension/shared/status-sync.test.ts`)
- [x] GREEN: `statusSync.diff` en `apps/extension/src/shared/statusSync.ts`.
- [x] RED: test de `statusSync.intervalFor(status)` — 2s para `pending`/`joining`/`waiting_admission`, 5s para `recording`/`transcribing`/`summarizing`.
- [x] GREEN: `intervalFor` en `statusSync.ts`.
- [x] RED: test de `statusSync.transition(state, event)` — máquina de estados pura con effects ADT. Casos: SUBSCRIBE primer suscriptor → `{startLoop, fetchSnapshot}`; SUBSCRIBE segundo suscriptor → `{fetchSnapshot}`; onDisconnect último Port → `{stopLoop}`; POLL_RESPONSE terminal → `{broadcast, stopLoop, disconnectPorts}`; POLL_RESPONSE request en vuelo → no-op; handshake timeout → `{disconnectPort}`.
- [x] GREEN: `transition` en `statusSync.ts` con effects ADT.
- [x] RED: test multi-meeting — dos `meetingId` distintos con Ports independientes; broadcast a uno no llega al otro.
- [x] GREEN: ajustar `transition` para multi-meeting.
- [x] Integrar `statusSync.diff` en el widget: `mount()` (innerHTML una vez) + `patch(diff)` (actualización quirúrgica). `setState` llama a `diff(prev, next)` → si vacío, no-op; si no, `patch(diff)`. (`apps/extension/src/content/widget.ts`)
- [x] Integrar `statusSync.transition` en el SW: SW recibe eventos (SUBSCRIBE, POLL_RESPONSE, onDisconnect, handshake timeout), llama `transition`, ejecuta effects. (`apps/extension/src/background/service-worker.ts`)
- [x] Content script: abrir Port al montar widget; mandar `SUBSCRIBE` cuando tenga `meetingId` (post-CHECK_STATUS o post-INVITE_BOT). Eliminar `setInterval` de polling propio. (`apps/extension/src/content/widget.ts`, `apps/extension/src/content/content.ts`)
- [x] Popup: modo "buscando meeting" (mini-poll CHECK_STATUS 2s via sendMessage); modo "suscripto" (Port + SUBSCRIBE + broadcasts). Eliminar loop de 5s propio. (`apps/extension/src/popup/popup.ts`)
- [x] SW: `chrome.alarms` 30s como fallback degradado cuando no hay Ports activos. (`apps/extension/src/background/service-worker.ts`)
- [x] SW: `INVITE_BOT` queda como handler de `sendMessage` (stateless, como hoy). (`apps/extension/src/background/service-worker.ts`)
- [x] REFACTOR con la suite en verde (nombres, eliminación de código de polling duplicado en widget y popup).
- [ ] Validación manual en un Meet real: registrar tiempos observados de cada transición en widget y popup (dejar evidencia en esta carpeta). **PENDIENTE: validación manual en Meet real (exception declarada per AGENTS.md — requiere acceso a Google Meet en vivo). Feature archivada con verificación automatizada completa; la validación manual se realiza post-merge.**
- [x] `bun run extension:build` y actualizar `docs/extension.md`.
- [x] Validar contra los criterios de aceptación de `spec.md`.
- [x] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
