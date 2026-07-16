# 006 · Migrar el despliegue del worker a Railway (solo development) — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._

_**Nota de validación (excepción de `AGENTS.md`):** esta feature es infra/configuración y captura
multimedia del worker (Puppeteer + FFmpeg), que `AGENTS.md` exime del TDD unitario. Por eso los pasos de
infra se validan por **integración/manual**, NO se fuerza el orden RED → GREEN → REFACTOR sobre ellos.
La única excepción es el eventual fix de `--disable-dev-shm-usage`: si hay que aplicarlo, esa pieza de
lógica sí lleva su micro-test (RED → GREEN → REFACTOR)._

- [x] **Storage:** crear el bucket S3-compatible de Railway (`tldv-meetings-dev` → `tldv-meetings-dev-wlwoxrq`,
      endpoint `https://t3.storageapi.dev`) en `TLDV-DEV`/`dev-remote`.
- [x] **Checkpoint S3:** validado round-trip (PutObject/GetObject/DeleteObject) contra el bucket con el
      `S3StorageProvider` actual, sin cambios de código. (El MinIO público del VPS quedó descartado: sirve
      la consola, no la API S3, y no hay acceso al VPS.)
- [x] Crear `.railwayignore` en la raíz del repo excluyendo lo que `Dockerfile.worker` no necesita
      (`apps/web`, `apps/extension`, artefactos, `.env*`). (Commit `a255dae`.)
- [x] `railway add --service worker` en el proyecto `TLDV-DEV`, environment `dev-remote`.
- [x] Configurar el builder del servicio como **DOCKERFILE** apuntando a `Dockerfile.worker` — ahora
      versionado también en `railway.json` (raíz).
- [x] Cargar las variables de entorno en el store de Railway: bloque `S3_*` del bucket, DB de Supabase
      dedicada, `GROQ_API_KEY`/`GEMINI_API_KEY`, `WORKER_INTERNAL_PORT`, `WORKER_MAX_CONCURRENT=1`,
      `WORKER_MAX_ATTEMPTS=3`, `WORKER_RETRY_BASE_MS`. Inventario completo por nombre en
      `docs/deployment.md`. (`GOOGLE_SERVICE_ACCOUNT_JSON` queda diferido: auto-join deshabilitado.)
- [x] Desplegar con `railway up` (`--detach` manual desde local; deploys `e69c04c5`/`a2e75bba` SUCCESS).
- [x] Verificar `railway deployment list --json` hasta estado `SUCCESS`. Deploy `497ec914-…` confirmado
      `SUCCESS`; runtime logs muestran arranque limpio (PulseAudio, API interna en :4000, polling cada 5s).
- [x] **Cutover:** resuelto doblemente — la grabación de prueba apareció en el bucket de Railway
      (`google-meet/ef094d9d-….mp4`), y además la cola de dev pasó a una **Supabase dedicada** a la que
      el worker viejo del VPS no apunta: solo el worker de Railway pollea esta cola.
- [x] Validar `GET /health` → `200` desde el dominio público que asigna Railway. Dominio generado
      `https://worker-dev-remote.up.railway.app` (puerto 4000) → `200 {"status":"ok","role":"worker",...}`.
- [x] Correr una reunión de prueba corta end-to-end y confirmar estado `completed` (MP4 en el bucket de
      Railway + transcripción con Groq + resumen; reproducción/descarga verificadas desde la web,
      16/07/2026).
- [x] Revisar los logs: sin crashes de `/dev/shm` de Chromium en varios deploys y grabaciones.
- [x] **Reactivo (solo si crashea shm):** no aplicó — no hubo crashes, `--disable-dev-shm-usage` no fue
      necesario.
- [x] **Documentación (fase posterior):** ADR en `docs/adr/0001-worker-railway-dev.md`, contexto de
      deployment en `docs/deployment.md` (el `docs/CONTEXT.md` existente es el glosario de auth y se dejó
      intacto), y `deploy.sh` + workflows marcados como "inactivos para este repo -dev" en ambos docs.
- [x] Repuntar `WORKER_INTERNAL_BASE_URL` (en Vercel) al nuevo dominio de Railway
      (`https://worker-dev-remote.up.railway.app`, cargada en el proyecto Vercel `tldv-squaads-dev`).
- [x] Validar contra los criterios de aceptación de `spec.md` — todos cumplidos (ver spec, marcados con
      evidencia).
- [x] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
