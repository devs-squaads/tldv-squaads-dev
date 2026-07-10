# 002 · Login con scope reducido + allowlist + super admin — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._
_Orden TDD (RED → GREEN → REFACTOR): primero el test que falla, luego el código mínimo que lo pasa. Tests en `apps/__tests__/<app>/<área>/` (ver `../../constitution/tech-stack.md` → Testing)._

## Schema + backfill

- [x] Test: la migración crea `authorized_accounts` y hace backfill de todos los emails de `users` como `member` activo (RED).
- [x] Migración Drizzle: tabla `authorizedAccounts` + script de backfill (GREEN).

## Gate de acceso en el login

- [x] Test: `signIn` rechaza un email que no está en la allowlist y no es super admin (RED).
- [x] Test: `signIn` autoprovisiona como `admin` activo un email listado en `SUPER_ADMIN_EMAILS` (RED).
- [x] Test: `signIn` acepta un email ya activo en `authorized_accounts` (incluido el backfill) (RED).
- [x] Implementación: `AuthorizedAccountRepository` (`findByEmail`, `upsert`, `setActive`) (GREEN).
- [x] Implementación: gate de allowlist + bootstrap de super admin en el callback `signIn` de `auth.ts` (GREEN).
- [ ] Refactor: extraer la resolución de rol a un módulo propio si `auth.ts` crece demasiado (REFACTOR) — no hizo falta, `resolveAuthorizedRole` quedó en ~25 líneas dentro de `auth.ts`; revisar si el archivo sigue creciendo.
- [x] Quitar `calendar.readonly` / `access_type: offline` / `prompt: consent` del `GoogleProvider` de login; dejar `prompt: select_account` (validación manual — es config OAuth, no lógica de test).
- [x] Test: los callbacks `jwt`/`session` exponen `role` en `session.user` (RED).
- [x] Implementación: propagar `role` en `jwt`/`session` (GREEN).

## Conexión de Calendario separada

- [x] Test: `GET /api/settings/calendar-connect` redirige a Google con el scope y `prompt: consent` correctos (RED).
- [x] Test: el callback intercambia el `code`, persiste tokens y pone `calendarEnabled: true` (RED).
- [x] Implementación: rutas `calendar-connect` + `calendar-connect/callback` (GREEN).

## Administración de la allowlist

- [x] Test: las rutas `admin/authorized-accounts` devuelven 401/403 si `role !== "admin"` (RED).
- [x] Test: un admin puede dar de alta y desactivar un email autorizado (RED).
- [x] Implementación: rutas `api/admin/authorized-accounts` (GET, POST) y `[email]` (PATCH) (GREEN).

## UI

- [x] Botón "Conectar Calendario" en Ajustes apuntando a la nueva ruta (ya no asume token existente).
- [x] Sección "Equipo" en Ajustes (solo visible para `role === "admin"`) para listar/agregar/desactivar emails.

## Cierre

- [x] Validación por integración/manual en local: login como admin y conectar Calendario desde Ajustes funciona end-to-end (verificado por el usuario tras registrar el `redirect_uri` en Google Cloud Console). Falta todavía probar en dev remoto/producción una vez que esos ambientes tengan su propio registro en Google Console.
- [x] Actualizar `README.md` y `.env.*.example` con `SUPER_ADMIN_EMAILS` — hecho (usuario agregó `SUPER_ADMIN_EMAILS` a `.env.development.example`/`.env.production.example`, confirmado por diff).

## Hardening post-revisión (no estaba en el checklist original)

- [x] Test + fix: el callback `jwt` re-resuelve el rol en cada llamada (no solo en el login inicial) — desactivar a alguien ahora corta el acceso elevado en el siguiente request, no en 30 días.
- [x] Test + fix: `calendar-connect` genera y valida un `state` (cookie `httpOnly` de 10 min) para evitar CSRF en el enlace de Calendario.
- [ ] Validar contra los criterios de aceptación de `spec.md`. — cubierto por tests automatizados donde aplica; los criterios que dependen de un login real de Google quedan pendientes de validación manual.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`. — pendiente de que el humano revise y mergee.

## Mantenimiento (checklist recurrente)

- [ ] Si se agrega un nuevo super admin permanente, sumarlo a `SUPER_ADMIN_EMAILS` en los tres entornos (dev local, dev remoto, producción) y actualizar el `.example` correspondiente.
