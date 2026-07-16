# 007 · Sincronización de estados de la extensión

**Estado:** propuesta (pendiente — sin iniciar)

## Qué hace

El usuario ve el estado real del bot (Queued → Joining → Waiting admission → Recording → Transcribing → Summarizing → Completed) reflejado con baja latencia y de forma consistente tanto en el widget flotante dentro de la reunión como en el popup de la extensión. El widget no parpadea ni pierde la interacción (drag) al refrescarse.

## Por qué

Hallazgos del testing manual del 16/07/2026 (registrados en memoria, topic `extension/status-latency`):

- Los cambios de estado tardan mucho en reflejarse (el bot ya está grabando y la UI sigue en "Waiting admission").
- El popup no actualiza los estados correctamente y puede mostrar un estado distinto al del widget en el mismo instante.
- El botón flotante no se actualiza bien al cambiar el estado.

Causa raíz investigada: polling HTTP puro con piso de 5s (`POLL_INTERVAL_MS`), dos loops independientes (widget y popup) contra los mismos endpoints, ticks descartados cuando una request tarda más que el intervalo, y re-render completo vía `innerHTML` en cada respuesta aunque el estado no cambie.

## Criterios de aceptación

- [ ] Un cambio de estado en la base de datos se refleja en widget y popup en ≤ 3 s en condiciones normales.
- [ ] Widget y popup nunca muestran estados distintos durante más de un ciclo de refresco (fuente de estado única).
- [ ] El widget no se re-renderiza si el estado no cambió (sin parpadeo; un drag en curso no se interrumpe).
- [ ] Una request lenta o colgada no congela las actualizaciones más allá del timeout configurado; el ciclo se recupera solo.
- [ ] Existe un único loop de polling activo por meeting (sin duplicación widget + popup).

## Fuera de alcance

- **Canal push (SSE/WebSockets)** — evolución natural de esta feature; queda en el backlog del roadmap ("SSE/WebSockets para estado en tiempo real").
- Mejoras del contenido/calidad de transcripciones (pendiente aparte).
- Cambios en el pipeline de estados del worker (escribe los estados puntualmente; verificado).
