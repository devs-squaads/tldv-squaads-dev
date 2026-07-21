# 007 · Sincronización de estados de la extensión

**Estado:** propuesta (pendiente — sin iniciar)

## Qué hace

El usuario ve el estado real del bot reflejado con baja latencia y consistencia entre widget y popup. El widget no parpadea ni pierde interacción (drag) al refrescarse.

## Por qué

Hallazgos del testing manual del 16/07/2026 (registrados en memoria, topic `extension/status-latency`):

- Los cambios de estado tardan mucho en reflejarse (el bot ya está grabando y la UI sigue en "Waiting admission").
- El popup no actualiza los estados correctamente y puede mostrar un estado distinto al del widget en el mismo instante.
- El botón flotante no se actualiza bien al cambiar el estado.

Causa raíz investigada: polling HTTP puro con piso de 5s (`POLL_INTERVAL_MS`), dos loops independientes (widget y popup) contra los mismos endpoints, ticks descartados cuando una request tarda más que el intervalo, y re-render completo vía `innerHTML` en cada respuesta aunque el estado no cambie.

## Criterios de aceptación

- [ ] Un cambio de estado en la base de datos se refleja en widget y popup en ≤ 3 s en condiciones normales (intervalo adaptativo: 2s en fases transitorias, 5s en fases estables).
- [ ] Widget y popup nunca muestran estados distintos (Single Poller como única fuente de polling; backend es source of truth).
- [ ] El widget no se re-renderiza si el estado no cambió; cuando cambia, el render es quirúrgico (patch de atributos específicos, no innerHTML rebuild). Un drag en curso no se interrumpe.
- [ ] Una request lenta o colgada no congela las actualizaciones más allá del timeout configurado; el ciclo se recupera solo (no solapar; relanzar inmediatamente tras resolución).
- [ ] Existe un único loop de polling activo por meeting en el service worker (Single Poller), con difusión `MEETING_UPDATE` a widget y popup vía Port.
- [ ] El service worker mantiene un mapa `meetingId → Set<Port>` para enrutar broadcasts al meeting correcto (soporta múltiples meetings simultáneos).
- [ ] Tras un estado terminal (completed/error/rejected/admission_timeout), el SW hace un broadcast final garantizado a todos los Ports antes de detener el loop y desconectar los Ports.

## Límites conocidos (declarados)

- Latencia pico = `REQUEST_TIMEOUT_MS` (10s) durante una request colgada. Sin mitigación dentro del scope de 007 (el canal push SSE/WebSockets queda fuera de alcance).
- Degradación a 30s vía `chrome.alarms` cuando no hay ningún consumidor vivo (SW suspendido sin Port de keepalive). Aceptable porque no hay consumidor mirando.
- `chrome.alarms` tiene un mínimo de 30s (Chrome 120+); no puede usarse como tick base de 2s. Es solo fallback degradado.

## Fuera de alcance

- **Canal push (SSE/WebSockets)** — evolución natural en backlog.
- Mejoras de contenido/calidad de transcripciones.
- Cambios en el pipeline de estados del worker (escribe los estados puntualmente; verificado).
