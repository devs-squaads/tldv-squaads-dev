# Roadmap

> Orden y estado de las features. Vista de "qué hay hecho, qué toca ahora y qué viene". Cada entrada en
> curso/futura apunta a su carpeta en `features/`. El histórico detallado pre-SDD vive en
> `../../docs/PROJECT_PROGRESS_LOG.md` (archivo congelado).

## Hecho ✅

_Fases completadas, en orden de implementación (heredadas del tracking previo)._

1. **Fase 1 · Setup y Base de Datos (local)** — bootstrap del proyecto y esquema inicial.
2. **Fase 2 · Motor de Bots (core)** — trasplante del runner/bot de captura.
3. **Fase 3 · Integración de APIs** — transcripción (Deepgram/Groq) y resumen (OpenAI/Gemini).
4. **Fase 4 · Frontend y UI** — dashboard self-hosted.
5. **Fase 5 · Despliegue (Docker)** — imágenes y compose por servicio.
6. **Fase 6 · Arquitectura Web/Worker** — split de roles y despliegue separado.
7. **Fase 7 · Storage abstracto + IA + Auto-Join** — `StorageProvider`, mejoras de IA y auto-join por
   Google Calendar.
8. **Fase 8 (chat) · Rediseño del chat sin LangChain** — runtime propio, hardening del trust boundary,
   policy de tools y cobertura de tests. Validado manualmente y cerrado a nivel documental.
9. **Fase 9 · Deploy automatizado del worker (servidor Squaads)** — CI/CD con GitHub Actions (deploy en push
   a `dev`/`main`), `deploy.sh`, composes `docker-compose.worker.{development,production}.yml` con red
   `nginx_network`, hardening `isAuthorized()` fail-closed y endpoint `GET /health`. Detalle en
   `../../docs/PROJECT_PROGRESS_LOG.md` (sección Fase 9).
10. **005 · Refresh del corpus de conocimiento del chat helper** — corpus documental actualizado (roles de
    equipo, auth gate/redirección a login, seguridad de datos/RLS, settings-storage alineado con la Settings
    UX de PR #33) más inyección en vivo del rol del usuario (admin/member) en `buildUserContext`. Contenido
    aditivo, sin cambios de tool surface, env ni retriever. Detalle en
    [`features/005-chat-knowledge-refresh/`](../features/005-chat-knowledge-refresh/spec.md).
11. **006 · Worker de development en Railway** — worker-dev migrado del VPS a Railway (proyecto
    `TLDV-DEV`), con bucket S3 de Railway y Supabase dedicada para la cola de dev; E2E validado
    (grabación → transcripción → resumen → `completed`) e incluye el fix de retry por etapas
    (post-upload no re-entra al Meet). Web desplegada en Vercel con configs versionadas. ADR en
    [`../../docs/adr/0001-worker-railway-dev.md`](../../docs/adr/0001-worker-railway-dev.md), contexto
    operativo en [`../../docs/deployment.md`](../../docs/deployment.md). Detalle en
    [`features/006-worker-railway-dev/`](../features/006-worker-railway-dev/spec.md). **Pendiente
    heredado**: CI/CD del worker en Railway + retiro de workflows del VPS (rama `chore/railway-cicd`).
12. **007 · Sincronización de estados de la extensión** — **hecho ✅ (archivado 2026-07-18)**. Single Poller
    + Port-as-keepalive en el service worker; `status-sync.ts` como máquina de estados pura con effects ADT
    (TDD: 25 tests nuevos, 205 total en verde, 0 regresiones); render quirúrgico `mount()` + `patch(diff)`
    que preserva el drag del widget; intervalo adaptativo 2s (transitorio) / 5s (estable); broadcast final
    garantizado en estados terminales (broadcast → stopLoop → disconnectPorts). 7/7 criterios de aceptación
    cumplidos. Pendiente declarado: validación manual en Meet real (excepción per `AGENTS.md` — requiere
    Google Meet en vivo; se realiza post-merge). Detalle en
    [`features/007-extension-status-sync/`](../features/007-extension-status-sync/spec.md).
13. **009 · Ownership de reuniones y compartición personalizada (+ naming de S3)** — cada grabación pertenece
    a un Owner único (`meetings.ownerId` NOT NULL); acceso restringido a ese Owner más Access Grants
    explícitos y opcionalmente caducables — el tipo de share `"public"` fue eliminado por completo, sin
    excepción de rol admin en la visibilidad de listado/detalle. Claves S3 nombradas con nombre+fecha de
    reunión, persistidas en `recordingStorageKey` para no desincronizarse ante cambios futuros de naming.
    Mergeado a `dev` en una cadena de ~10 PRs (#28 tracker + #29, #33, #35-#41: schema, owner-capture,
    read-scoping, access-grants, share-retrofit, remoción de public+sugerencias de participantes, s3-naming).
    ADRs en
    [`../../docs/adr/0005-meeting-ownership-personalized-sharing.md`](../../docs/adr/0005-meeting-ownership-personalized-sharing.md)
    y
    [`../../docs/adr/0006-recording-storage-key-naming-persistence.md`](../../docs/adr/0006-recording-storage-key-naming-persistence.md).
    Detalle en [`features/009-meeting-ownership-sharing/`](../features/009-meeting-ownership-sharing/spec.md).
    **Nota de exactitud:** la Fase 8 (verificación) del propio `tasks.md` quedó sin marcar (`bun test`,
    lint/typecheck/build y walkthrough manual, los tres ítems en `[ ]`) — no hay evidencia registrada a ese
    nivel, aunque las suites completas corridas después en las features 010 y 013 (que construyen
    directamente sobre este código) pasaron en verde sin regresiones.
14. **010 · Dedup de auto-join, acceso compartido automático y recuperación de transcripción** — índice único
    parcial (`meetings_source_event_unique_idx`) + `insertDedupedBySourceEvent` evitan bots duplicados por el
    mismo evento de calendario; co-attendees registrados de una reunión auto-join reciben un Access Grant
    automático (excepción ADR-0007 al modelo owner-only de 009); nuevo estado `transcription_error`
    recuperable — el video queda visible y se ofrece reprocesar en vez del rejoin destructivo. 313 tests en
    verde (incluye bloques live-DB), lint/typecheck/build limpios. ADR en
    [`../../docs/adr/0007-auto-join-co-attendee-automatic-access-grant.md`](../../docs/adr/0007-auto-join-co-attendee-automatic-access-grant.md).
    Detalle en
    [`features/010-auto-join-dedup-and-recovery/`](../features/010-auto-join-dedup-and-recovery/spec.md).
    Pendiente declarado: walkthrough manual en vivo (dos polls simultáneos de auto-join, revocación de
    grant, fallo forzado de transcripción) — excepción per `AGENTS.md`, requiere navegador/Meet real; tarea
    4.3 explícitamente sin marcar.
15. **013 · Aprobación admin para compartición de members + proveedor SMTP real** — cuando el Owner de una
    reunión tiene rol `member`, compartir crea un `Share Request` pendiente en vez de un share directo; solo
    un `admin` (autoridad global, no ligada a ser Participant) puede aprobar/rechazar, con rechazo silencioso
    y descubrimiento pasivo del resultado. Tres modos de destinatario (todos los participantes / subset /
    email manual) y tres tipos de acceso (`single_use`, `temporary` con días editables, `permanent`). Nuevo
    `SmtpEmailProvider` (Nodemailer) reemplaza el log de consola cuando `EMAIL_PROVIDER=smtp`; en producción,
    config SMTP incompleta bloquea el envío con error explícito en vez de degradar a consola. Mergeado a
    `dev` vía PR #55 (commit `7f4b2c9`). ADRs en
    [`../../docs/adr/0004-smtp-email-provider.md`](../../docs/adr/0004-smtp-email-provider.md) y
    [`../../docs/adr/0008-member-share-admin-approval.md`](../../docs/adr/0008-member-share-admin-approval.md).
    Detalle en
    [`features/013-meeting-share-approval/`](../features/013-meeting-share-approval/spec.md). Pendiente
    declarado: walkthrough manual completo (tarea 9.3) — parcialmente ejecutado post-escritura de esa nota
    (ver el propio `tasks.md` para el detalle de qué se validó en vivo y qué falta: aprobación/rechazo admin
    y el compartir directo de un Owner admin).

## Siguiente 🔜

_Lo próximo a abordar._

16. **011 (Fase B) · Refresh del corpus + alineación del chat con 009/010** — Fase A (PR-A: botón de reporte
    reubicado, copy en voseo, respuesta de Soporte) ya mergeada, 15 tareas cumplidas. Pendiente Fase B (PR-B,
    12 tareas, ninguna iniciada): `MEETING_STATUSES` como export canónico consumido por
    `searchMeetingsTool`, y refresh del corpus documental del chat con los deltas de 009 (sharing sin
    público, Access Grants) y 010 (`transcription_error` recuperable). →
    [`features/011-chat-support-alignment/`](../features/011-chat-support-alignment/spec.md)
17. **001 · Rollout interno de la extensión** — sin movimiento desde la última revisión (ningún ítem de
    `tasks.md` marcado): cargar el ZIP interno real en entornos compartidos, validar el flujo end-to-end
    fuera de local y sustituir hosts locales por dominio real. →
    [`features/001-extension-rollout/`](../features/001-extension-rollout/spec.md)

## Seguridad — pendientes conocidos ⚠️

_Hallazgos confirmados vía advisor. RLS implementado y mergeado a `dev`, falta el último paso._

- **RLS hardening (004-rls-hardening)** — implementado, mergeado a `dev` (PR #32) y aplicado en
  dev-remote (advisor confirmó ERROR → INFO en las 6 tablas). Detalle en
  [`README.md`](../../README.md#seguridad-de-la-base-de-datos-rls) y
  [`features/004-rls-hardening/`](../features/004-rls-hardening/spec.md). **Pendiente**: aplicar
  `drizzle/0005_enable_rls.sql` en el proyecto Supabase de **producción** en el próximo deploy a
  `main` — no se comparte automáticamente con dev-remote.

## Backlog / ideas 💡

_Sin comprometer ni ordenar del todo. Respetan la constitución._

- **Observability V2** — logger estructurado, soporte seguro desde el chat, métricas protegidas y stack
  self-hosted separado. Diseño en `../../docs/OBSERVABILITY_PLAN.md` (diferido, no implementado).
- **Extensión multi-plataforma** — soporte de Meet/Teams/Zoom Web con adapters. PRD en
  `../../docs/extension.md`.
- **Dashboard con filtros, métricas y paginación** (heredado del tracking de Fase 9).
- **SSE/WebSockets para estado en tiempo real** (heredado del tracking de Fase 9; evolución natural de
  [`007-extension-status-sync`](../features/007-extension-status-sync/spec.md)).
- **Búsqueda semántica sobre transcripciones** (heredado del tracking de Fase 9).
- **Métricas/observabilidad avanzada del worker** (heredado del tracking de Fase 9).
- **012 · Nombre de bot por usuario** — idea capturada, ciclo SDD sin iniciar (solo existe `spec.md`, con su
  propio "Status: idea" — sin `plan.md`/`tasks.md`). Cada usuario podría fijar desde Settings su propio
  nombre de bot por defecto para las reuniones que su cuenta auto-une, en vez del único `BOT_DEFAULT_NAME`
  global actual. → [`features/012-per-user-bot-name/spec.md`](../features/012-per-user-bot-name/spec.md)

## Descartado ❌

_Ideas evaluadas y NO se harán (por ahora), con el motivo, para no re-proponerlas a ciegas._

- **Reorganizar Docker en `docker/`** — cancelado por **riesgo operativo**. La Fase 9 confirmó que el worker
  se despliega por **CI/CD automatizado** (GitHub Actions + `deploy.sh` + `docker-compose.worker.*.yml`) en
  push a `dev`/`main`. Mover los `docker-compose*.yml`/`Dockerfile.*` rompería esos workflows y el deploy
  hasta reescribir rutas en CI y en el server. Beneficio (root limpio) no justifica el riesgo. Reconsiderar
  solo con ventana de mantenimiento y actualizando los workflows en el mismo cambio.

> Cada feature nueva se crea como `features/NNN-nombre-feature/` con `spec.md`, `plan.md` y `tasks.md`
> **antes** de tocar código.
