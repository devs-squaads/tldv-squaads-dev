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

## Siguiente 🔜

_Lo próximo a abordar. Una sola feature "en curso" a la vez._

10. **001 · Rollout interno de la extensión** — cerrar los pendientes vivos de Fase 8: cargar el ZIP interno
    real en entornos compartidos, validar el flujo end-to-end fuera de local y sustituir hosts locales por
    dominio real. → [`features/001-extension-rollout/`](../features/001-extension-rollout/spec.md)

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
- **SSE/WebSockets para estado en tiempo real** (heredado del tracking de Fase 9).
- **Búsqueda semántica sobre transcripciones** (heredado del tracking de Fase 9).
- **Métricas/observabilidad avanzada del worker** (heredado del tracking de Fase 9).

## Descartado ❌

_Ideas evaluadas y NO se harán (por ahora), con el motivo, para no re-proponerlas a ciegas._

- **Reorganizar Docker en `docker/`** — cancelado por **riesgo operativo**. La Fase 9 confirmó que el worker
  se despliega por **CI/CD automatizado** (GitHub Actions + `deploy.sh` + `docker-compose.worker.*.yml`) en
  push a `dev`/`main`. Mover los `docker-compose*.yml`/`Dockerfile.*` rompería esos workflows y el deploy
  hasta reescribir rutas en CI y en el server. Beneficio (root limpio) no justifica el riesgo. Reconsiderar
  solo con ventana de mantenimiento y actualizando los workflows en el mismo cambio.

> Cada feature nueva se crea como `features/NNN-nombre-feature/` con `spec.md`, `plan.md` y `tasks.md`
> **antes** de tocar código.
