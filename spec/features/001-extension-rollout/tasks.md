# 001 · Rollout interno de la extensión — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._

- [ ] Regenerar el ZIP interno con `bun run extension:build`.
- [ ] Parametrizar el dominio de API/host en `apps/extension/src` + `manifest.json` (quitar `localhost` hardcodeado).
- [ ] Grep de `localhost`/`127.0.0.1` en la extensión para confirmar que no quedan hosts locales.
- [ ] Distribuir el ZIP y cargarlo en al menos un entorno compartido (no local).
- [ ] Validar onboarding seguro (`link-token` + `connect`) contra el dominio real.
- [ ] Probar flujo end-to-end en una reunión real desde entorno no local (invitar bot → estado → badge).
- [ ] Validar contra los criterios de aceptación de `spec.md`.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.

## Mantenimiento (checklist recurrente)

- [ ] Tras cambios en `apps/extension/src`: `bun run extension:build` y recargar unpacked antes de probar.
