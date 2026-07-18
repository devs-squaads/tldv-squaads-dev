# 007 · Sincronización de estados de la extensión — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

Centralizar el polling de estado en el service worker de la extensión (Single Poller). El SW es el único componente que hace `GET` de Meeting Status al backend por meeting activo. Su memoria en MV3 no es persistente: al despertar, la caché está fría y debe re-fetchear antes de responder a un suscriptor tardío. El backend (Supabase vía web API) es la única fuente de verdad; cualquier valor retenido en el cliente es una caché cálida.

## Implementación

1. **`statusSync.ts` como máquina de estados pura** — No es solo un comparador de igualdad ni un diff patcher aislado. Es una máquina de estados pura que recibe `{state, event} → {newState, effects[]}`. Los effects son un ADT: `{type: "broadcast", meetingId, status} | {type: "startLoop", meetingId, interval} | {type: "stopLoop", meetingId} | {type: "disconnectPorts", meetingId} | {type: "fetchSnapshot", meetingId, port}`. El SW es una capa fina que delega en `statusSync` para cada decisión. Path: `apps/extension/src/shared/statusSync.ts`.

2. **Diff patcher dentro de la máquina** — `statusSync.diff(prevStatus, nextStatus)` devuelve un patch (qué atributo de qué nodo actualizar), no un booleano. El render del widget se parte en `mount()` (una vez, crea DOM vía innerHTML) y `patch(diff)` (N veces, actualiza atributos específicos sin destruir el nodo arrastrado). Path: `apps/extension/src/content/widget.ts`.

3. **Single Poller en el service worker con Port-as-keepalive** — El content script abre un `chrome.runtime.connect` de larga vida al SW; ese Port es simultáneamente: (1) el canal por donde viajan los `MEETING_UPDATE`, (2) el keepalive que mantiene al SW despierto (Chrome 114+: long-lived messaging keeps SW alive), y (3) el contador de suscriptores (SW cuenta Ports abiertos; si >0, loop activo; si ==0, cae a `chrome.alarms` 30s). El popup también abre un Port (efímero, pero cuenta como suscriptor). Path: `apps/extension/src/background/service-worker.ts`, `apps/extension/src/content/content.ts`, `apps/extension/src/popup/popup.ts`.

4. **Handshake explícito `SUBSCRIBE {meetingId, provider}`** — Cada consumidor, al abrir un Port, envía inmediatamente `port.postMessage({type: "SUBSCRIBE", meetingId, provider})`. El SW lee eso, registra el Port bajo esa key, y responde con el snapshot actual (fetch síncrono si caché fría). Timeout de handshake: si un Port no manda `SUBSCRIBE` en 2s, el SW lo desconecta. El SW mantiene un registro paralelo `meetingId → { ports: Set<Port>, loop: { timer, inFlight, lastStatus, intervalFor } }`. Cuando el último Port de un meeting se desconecta (contador == 0), el SW detiene el loop.

5. **`SUBSCRIBE` arranca el loop** — El primer `SUBSCRIBE` para un `meetingId` sin loop activo hace fetch inicial, responde con el snapshot, y arranca el loop adaptativo. Si ya hay loop activo, responde con caché (o fetch si está fría). El `SUBSCRIBE` es el único punto de entrada al loop.

6. **`INVITE_BOT` queda como comando stateless via `sendMessage`** — Separación CQS: `INVITE_BOT` es un comando (mutación: crea meeting en backend); `SUBSCRIBE` es una suscripción (lectura). El widget hace `INVITE_BOT` via `sendMessage` (como hoy), obtiene `meetingId`, luego manda `SUBSCRIBE` via Port. El popup obtiene `meetingId` via `CHECK_STATUS` (como hoy), luego abre Port y manda `SUBSCRIBE`.

7. **Popup con dos modos** — "Buscando meeting": mini-poll `CHECK_STATUS` a 2s via `sendMessage` (sin Port). "Suscripto": cuando un meeting aparece, abre Port, manda `SUBSCRIBE`, elimina el mini-poll. Transición unidireccional.

8. **Widget al montar** — Abre Port al montarse. Si ya conoce `meetingId` (via `CHECK_STATUS` al montar, caso de recarga con bot ya invitado), manda `SUBSCRIBE` inmediatamente. Si no hay meeting (bot sin invitar), espera a que el usuario clique "Invite Bot"; tras `INVITE_BOT` response, manda `SUBSCRIBE`.

9. **Intervalo adaptativo: 2s en fases transitorias (`pending`/`joining`/`waiting_admission`), 5s en el resto (`recording`/`transcribing`/`summarizing`)** — Justificación: reducir requests contra Supabase EU pooler en fases de cambio lento (recording dura 20-60 min; a 2s serían 600-1800 GETs por meeting). No es throttling de timers (el SW no sufre throttling de background-tab). `statusSync.intervalFor(status)` calcula el intervalo.

10. **Request lenta: no solapar; relanzar inmediatamente tras resolución** — El SW mantiene el guard `pollRequestInFlight`. Mientras una request vuela, los ticks se descartan (no encolan). Al resolver la request (ok o timeout), el SW lanza el siguiente fetch inmediatamente — no espera al próximo tick. El ciclo se recupera solo.

11. **Terminal: broadcast final garantizado, luego desconexión** — El SW detecta el estado terminal, hace un último broadcast a todos los Ports del meeting, luego detiene el loop, desconecta los Ports, y limpia el registro. Los suscriptores tratan `onDisconnect` post-terminal como "mantener el último estado mostrado" (no error). Si el usuario recarga la pestaña tras un meeting completado, el widget hace `CHECK_STATUS`, obtiene `completed`, muestra "Completed" y no abre Port ni suscribe.

12. **`chrome.alarms` como fallback degradado (NO tick base)** — `chrome.alarms` a 30s (mínimo de Chrome 120+) se usa solo como wake-up de seguridad cuando no hay ningún Port activo. No es el tick base del loop. Si el alarms despierta al SW y hay un meeting activo en el registro pero sin Ports, el SW hace un fetch y mantiene el registro; si un consumidor se reconecta (abre Port + SUBSCRIBE), recibe el snapshot y el loop vuelve a 2s/5s adaptativo.

13. **Regenerar el ZIP interno (`bun run extension:build`)** y actualizar `docs/extension.md` con la nueva arquitectura de estados.

## Decisiones

- **Port-as-keepalive + Single Poller antes que SSE** — resuelve la desincronización sin tocar la web ni la infraestructura. SSE queda como evolución en backlog. Ver ADR-0003.
- **`statusSync.ts` como máquina de estados pura** — la extensión no tiene harness de DOM para tests; extraer toda la lógica de decisión (diff, intervalo, gestión de loops, handshakes, cleanup) a una máquina pura con effects permite TDD real con Bun en `apps/__tests__/extension/`.
- **`chrome.alarms` no es tick base** — el plan original lo sugería como tick base; es falso. El mínimo es 30s (Chrome 120+). El tick base es `setInterval` en el SW mantenido vivo por Port de keepalive.
- **Mantener `REQUEST_TIMEOUT_MS=10s`** — el problema no es el timeout sino los ticks descartados sin relanzar. El scheduler nuevo relanza tras resolución.
- **`INVITE_BOT` y `SUBSCRIBE` separados (CQS)** — comando y suscripción en canales distintos (`sendMessage` vs Port).

## Riesgos

- **MV3 suspende el service worker** — mitigado por Port de keepalive desde el content script (Chrome 114+: long-lived messaging keeps SW alive). `chrome.alarms` 30s como fallback degradado.
- **Regresión de UX del widget (drag/posición)** — mitigado por render quirúrgico (`mount()` + `patch(diff)`) que nunca destruye el nodo arrastrado. Validación manual en Meet real documentada en tasks.md.
- **Throttling de background-tab** — el content script sufre throttling a ~1/min tras 5 min en pestaña en background. Mitigado: el loop vive en el SW, no en el content script; el SW no sufre throttling de pestaña.
- **Múltiples meetings simultáneos** — el SW soporta múltiples `meetingId` en el mapa, cada uno con su loop y su `Set<Port>`. Hay que testear el multi-meeting explícitamente.
