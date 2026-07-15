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
- [ ] Crear `.railwayignore` en la raíz del repo excluyendo lo que `Dockerfile.worker` no necesita
      (`apps/web`, `apps/extension`, artefactos, `.env*`).
- [ ] `railway add --service worker` en el proyecto `TLDV-DEV`, environment `dev-remote`.
- [ ] Configurar el builder del servicio como **DOCKERFILE** apuntando a `Dockerfile.worker`.
- [ ] Cargar las variables de entorno en el store de Railway: `S3_ENDPOINT` y `S3_PUBLIC_ENDPOINT` =
      `https://t3.storageapi.dev`, `S3_BUCKET` = `tldv-meetings-dev-wlwoxrq`, credenciales del bucket
      (`S3_ACCESS_KEY`/`S3_SECRET_KEY`, secretos — solo por nombre), `GOOGLE_SERVICE_ACCOUNT_JSON`
      (variante JSON), `WORKER_INTERNAL_PORT`, `WORKER_MAX_CONCURRENT=1`, conexión a la DB de Supabase
      (cola de dev) y demás env del worker.
- [ ] Desplegar con `railway up --ci`.
- [ ] Verificar `railway deployment list --json` hasta estado `SUCCESS`. Ante fallo, revisar logs y
      corregir configuración (no lógica de app).
- [ ] **Cutover:** parar el worker-dev del VPS para que solo Railway pollee la cola de dev.
- [ ] Validar `GET /health` → `200` desde el dominio público que asigna Railway.
- [ ] Correr una reunión de prueba corta end-to-end y confirmar estado `completed` (MP4 en el S3 del VPS
      + transcripción + resumen).
- [ ] Revisar los logs: sin crashes de `/dev/shm` de Chromium.
- [ ] **Reactivo (solo si crashea shm):** agregar `--disable-dev-shm-usage` a los args de Puppeteer en el
      launcher del worker (`apps/worker`), con su micro-test (RED → GREEN → REFACTOR); confirmar que el
      crash desaparece.
- [ ] **Documentación (fase posterior):** escribir ADR `docs/adr/000N-worker-railway-dev.md`,
      actualizar/crear `docs/CONTEXT.md` de deployment, y marcar `deploy.sh` + workflows de despliegue
      como "inactivos para el worker de este repo -dev".
- [ ] Repuntar `WORKER_INTERNAL_BASE_URL` (en Vercel) al nuevo dominio de Railway una vez el worker esté
      verde.
- [ ] Validar contra los criterios de aceptación de `spec.md`.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
