# 007 · Sincronización de estados de la extensión — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._
_Orden TDD (RED → GREEN → REFACTOR): primero el test que falla, luego el código mínimo que lo pasa. Tests en `apps/__tests__/extension/` (ver `../../constitution/tech-stack.md` → Testing)._

- [ ] RED: test de `statusSync` — con estado idéntico al anterior no se emite re-render; con estado nuevo sí (`apps/__tests__/extension/shared/status-sync.test.ts`).
- [ ] GREEN: módulo puro `apps/extension/src/shared/statusSync.ts` con la decisión de cambio de estado.
- [ ] RED: test del scheduler adaptativo — intervalo 2 s en `pending`/`joining`/`waiting_admission`, 5 s en el resto; un tick con request en vuelo no descarta la actualización siguiente.
- [ ] GREEN: scheduler mínimo que pasa el test.
- [ ] Integrar `statusSync` en el widget: `setState` idempotente y render que no interrumpe un drag en curso (`apps/extension/src/content/widget.ts`).
- [ ] Centralizar el polling en `service-worker.ts` con difusión `MEETING_UPDATE`; widget y popup eliminan sus loops propios y quedan como suscriptores.
- [ ] REFACTOR con la suite en verde (nombres, eliminación de código de polling duplicado).
- [ ] Validación manual en un Meet real: registrar tiempos observados de cada transición en widget y popup (dejar evidencia en esta carpeta).
- [ ] `bun run extension:build` y actualizar `docs/extension.md`.
- [ ] Validar contra los criterios de aceptación de `spec.md`.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
