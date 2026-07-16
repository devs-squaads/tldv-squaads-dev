# 006 · Migrar el despliegue del worker a Railway (solo development) — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

`railway up` **manual desde local** (sin CI todavía): se crea un servicio en Railway con builder
**DOCKERFILE** apuntando a `Dockerfile.worker`, se cargan las variables de entorno en el store de
Railway y se despliega. La transición a la nueva plataforma es un **cutover limpio en dev**: se para el
worker-dev del VPS antes de levantar el de Railway, de modo que solo Railway pollee la cola de dev en
Supabase (validación determinística). La validación es **integración/manual**, no TDD unitario: la
migración es casi 100% infra/config sin lógica de negocio unit-testeable, y `AGENTS.md` exime
explícitamente la captura multimedia del worker (Puppeteer + FFmpeg) del TDD. El worker de producción y
el VPS quedan intactos.

Cero cambios de código previstos: el worker ya soporta `GOOGLE_SERVICE_ACCOUNT_JSON` como env var
(`apps/worker/src/integrations/calendar/providers/GoogleCalendarProvider.ts:78`, con fallback a
`GOOGLE_SERVICE_ACCOUNT_FILE`), ya expone `GET /health` en `WORKER_INTERNAL_PORT` (default 4000) y
escribe el MP4 en `os.tmpdir()` borrándolo tras subir a S3.

## Implementación

_Pasos técnicos concretos, en orden. Indica los archivos/módulos que se tocan._

1. **Storage en Railway Bucket (hecho)** — el endpoint público del MinIO del VPS resultó ser la consola,
   no la API S3, y no hay acceso al VPS para exponerla. Se creó un bucket S3-compatible de Railway
   (nombre `tldv-meetings-dev` → real `tldv-meetings-dev-wlwoxrq`, endpoint `https://t3.storageapi.dev`,
   región `auto`) en `TLDV-DEV`/`dev-remote`, y se validó con un checkpoint end-to-end (PutObject +
   GetObject + DeleteObject) usando el `S3StorageProvider` actual
   (`packages/shared/src/integrations/storage/providers/S3StorageProvider.ts:40`) sin cambios de código.
2. **`.railwayignore`** (nuevo, en la raíz del repo) — excluir del contexto de build lo que no necesita
   `Dockerfile.worker` (p.ej. `apps/web`, `apps/extension`, artefactos, `.env*`), para acelerar el
   upload de `railway up` y evitar filtrar secretos locales.
3. **Crear el servicio** — `railway add --service worker` en el proyecto `TLDV-DEV`, environment
   `dev-remote`; configurar builder **DOCKERFILE** apuntando a `Dockerfile.worker`.
4. **Cargar las variables de entorno** en el store de Railway (SSOT de env para este servicio). Incluye,
   entre otras: `S3_ENDPOINT` y `S3_PUBLIC_ENDPOINT` = `https://t3.storageapi.dev`, `S3_BUCKET` =
   `tldv-meetings-dev-wlwoxrq`, credenciales del bucket de Railway (`S3_ACCESS_KEY`/`S3_SECRET_KEY`,
   secretos — solo por nombre, nunca en artefactos), `GOOGLE_SERVICE_ACCOUNT_JSON` (variante JSON, no
   bind-mount de archivo), `WORKER_INTERNAL_PORT`, `WORKER_MAX_CONCURRENT=1`, y la conexión a la DB de
   Supabase (cola de dev).
5. **Desplegar** — `railway up --ci` y verificar con `railway deployment list --json` hasta estado
   `SUCCESS`. Ante fallo de build/deploy, revisar logs y corregir config (no lógica de app).
6. **Cutover** — parar el worker-dev del VPS (que deje de pollear la cola de dev). A partir de acá solo
   Railway reclama reuniones de dev. Nota de correctitud: aunque corrieran en paralelo no habría
   doble-claim, porque `WorkerMeetingRepository.claimNextPending`
   (`apps/worker/src/repositories/WorkerMeetingRepository.ts:7`) usa `SELECT … FOR UPDATE SKIP LOCKED` +
   flip atómico `pending→joining`; el cutover se elige por observabilidad de la prueba, no por seguridad
   de datos.
7. **Validar** — `GET /health` responde `200` desde el dominio público de Railway; luego una reunión de
   prueba corta end-to-end hasta estado `completed` (MP4 en el S3 del VPS + transcripción + resumen).
8. **Reactivo si crashea shm** — si aparecen crashes de `/dev/shm` de Chromium en los logs, agregar
   `--disable-dev-shm-usage` a los args de Puppeteer (una línea) en el launcher del worker
   (`apps/worker`). Esa pieza, si se toca, lleva su micro-test (red → green → refactor); el resto no.
9. **Documentación (fase posterior)** — ADR en `docs/adr/000N-worker-railway-dev.md`, actualizar/crear
   `docs/CONTEXT.md` de deployment, y marcar `deploy.sh` + workflows de despliegue como "inactivos para
   el worker de este repo -dev". Y repuntar `WORKER_INTERNAL_BASE_URL` (en Vercel) al nuevo dominio de
   Railway cuando el worker esté verde.

**Archivos/artefactos afectados:** `.railwayignore` (nuevo, raíz); `spec/features/006-worker-railway-dev/*`;
docs (ADR `docs/adr/000N-…`, `docs/CONTEXT.md` de deployment); y posible `--disable-dev-shm-usage` en el
launcher de Puppeteer de `apps/worker` **solo si crashea**. No se toca el VPS ni el MinIO; no se editan
`Dockerfile.worker`, `docker-compose*.yml`, `deploy.sh` ni los workflows en esta ronda.

## Decisiones

_Elecciones de diseño relevantes y su justificación. Alternativas descartadas y por qué._

- **Transición = cutover limpio en dev** — se para el worker-dev del VPS antes de levantar el de
  Railway; solo una instancia pollea la cola de dev. Se descarta el **parallel-run** por
  **observabilidad**: con un solo poller la prueba es determinística y los logs son inequívocos. No es
  por seguridad de datos: el claim ya es atómico (`FOR UPDATE SKIP LOCKED`), así que un solapamiento no
  causaría doble-claim.
- **Deploy = `railway up` manual primero; CI (GitHub integration) en ronda aparte** — esta ronda solo
  prueba que `Dockerfile.worker` buildea y corre en Railway desde local. Se descarta cablear auto-deploy
  ahora para no conectar CI a algo aún no probado; primero se valida el runtime, después se automatiza.
- **Validación = integración/manual (NO TDD unitario)** — la migración es casi 100% infra/config sin
  lógica de negocio unit-testeable; `AGENTS.md` exime la captura multimedia (Puppeteer + FFmpeg) del TDD,
  validándola por integración/manual. Excepción: si se toca lógica real (el fix de
  `--disable-dev-shm-usage`), esa pieza sí lleva su micro-test red → green → refactor.
- **Storage = bucket S3-compatible de Railway (pivote); el VPS no se toca** — el checkpoint reveló que el
  endpoint público del MinIO del VPS sirve la consola, no la API S3, y sin acceso al VPS no se puede
  exponer. Se pivotó a un bucket de Railway (mismo proveedor/factura que el worker, sin cuenta nueva).
  Cero código: `S3StorageProvider` es agnóstico de proveedor, solo cambian las env vars. Se descartaron
  Cloudflare R2 (más barato por egress, pero cuenta nueva — queda como swap futuro para producción),
  Supabase Storage y AWS S3. Las credenciales del bucket son secretos: solo en el store de Railway.
- **`deploy.sh` y workflows no se borran en esta ronda** — este cambio toca conceptualmente el contrato
  de la Fase 9 (deploy automatizado del worker) de `spec/constitution/roadmap.md` y las reglas de
  `spec/constitution/tech-stack.md` (no tocar el contrato de despliegue para lógica de app; avisar
  explícitamente). Por eso, en lugar de eliminarlos, en la fase de documentación solo se marcan como
  "inactivos para el worker de este repo -dev". Su apagado/retiro real es la ronda de CI aparte.

## Riesgos

_Qué puede salir mal o requerir cuidado, y cómo se mitiga._

- **Memoria compartida de Chromium (`/dev/shm`)** — hoy el worker corre con `shm_size: "2gb"`
  (`docker-compose.worker.development.yml`) para Chromium + Xvfb + FFmpeg. Railway no expone un flag
  equivalente a `--shm-size`. **Mitigación reactiva:** si Chromium crashea por `/dev/shm`, agregar
  `--disable-dev-shm-usage` a los args de Puppeteer (una línea, con micro-test).
- **Costo de egress en producción** — el bucket de Railway factura el egress (descargas). En dev el
  volumen es chico, pero para producción conviene evaluar Cloudflare R2 (egress gratis); el cambio es solo
  de env vars porque el provider es agnóstico. Las grabaciones viejas de dev que quedaron en el MinIO del
  VPS se abandonan (las nuevas van al bucket de Railway) — aceptable en dev.
- **IP de egress de Railway** — Google Meet podría tratar de forma distinta al bot según la IP saliente
  al unirse a la reunión. **Mitigación:** se descubre en la reunión de prueba end-to-end; si hay
  bloqueo, se evalúa en una ronda aparte (no se resuelve especulativamente ahora).
- **Sizing de RAM/CPU del plan de Railway** — Chromium + FFmpeg + Xvfb pesan; el plan podría quedar
  corto. **Mitigación:** `WORKER_MAX_CONCURRENT=1` (una grabación a la vez) y observar métricas/logs
  durante la reunión de prueba; ajustar recursos del servicio si hace falta.
