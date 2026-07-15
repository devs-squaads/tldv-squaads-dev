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

1. **Checkpoint S3 (bloqueante)** — validar un `PutObject` de prueba contra el endpoint público de
   MinIO (`S3_PUBLIC_ENDPOINT` = `https://minio-tldv-dev.server.squaads.com/`) con las credenciales S3.
   `S3StorageProvider` usa `S3_ENDPOINT` para el `PutObject` de subida
   (`packages/shared/src/integrations/storage/providers/S3StorageProvider.ts:40`); en Railway se seteará
   `S3_ENDPOINT` = valor de `S3_PUBLIC_ENDPOINT`. Si escribir contra el público falla, se frena la ronda.
2. **`.railwayignore`** (nuevo, en la raíz del repo) — excluir del contexto de build lo que no necesita
   `Dockerfile.worker` (p.ej. `apps/web`, `apps/extension`, artefactos, `.env*`), para acelerar el
   upload de `railway up` y evitar filtrar secretos locales.
3. **Crear el servicio** — `railway add --service worker` en el proyecto `TLDV-DEV`, environment
   `dev-remote`; configurar builder **DOCKERFILE** apuntando a `Dockerfile.worker`.
4. **Cargar las variables de entorno** en el store de Railway (SSOT de env para este servicio). Incluye,
   entre otras: `S3_ENDPOINT` (= público), `S3_PUBLIC_ENDPOINT`, credenciales S3 (secretos — solo por
   nombre, nunca en artefactos), `GOOGLE_SERVICE_ACCOUNT_JSON` (variante JSON, no bind-mount de archivo),
   `WORKER_INTERNAL_PORT`, `WORKER_MAX_CONCURRENT=1`, y la conexión a la DB de Supabase (cola de dev).
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
- **S3 = se reutiliza el endpoint público existente; el VPS no se toca** — hoy `S3_ENDPOINT` es el
  hostname interno del Docker del VPS (`http://…:9000`, inalcanzable desde Railway) y `S3_PUBLIC_ENDPOINT`
  es público HTTPS (ya usado para firmar descargas). En Railway se setea `S3_ENDPOINT` = valor de
  `S3_PUBLIC_ENDPOINT` (ambos al público), porque `S3StorageProvider` usa `S3_ENDPOINT` para el
  `PutObject` de subida. Se descarta abrir/tocar el VPS. Las credenciales S3 son secretos: viven solo en
  el store de Railway, nunca en artefactos.
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
- **El endpoint S3 público podría no permitir escritura** — hoy se usa para firmar/servir descargas; que
  acepte `PutObject` de subida no está garantizado. **Mitigación:** checkpoint S3 temprano y bloqueante
  (paso 1); si falla, se frena antes de invertir en el resto.
- **IP de egress de Railway** — Google Meet podría tratar de forma distinta al bot según la IP saliente
  al unirse a la reunión. **Mitigación:** se descubre en la reunión de prueba end-to-end; si hay
  bloqueo, se evalúa en una ronda aparte (no se resuelve especulativamente ahora).
- **Sizing de RAM/CPU del plan de Railway** — Chromium + FFmpeg + Xvfb pesan; el plan podría quedar
  corto. **Mitigación:** `WORKER_MAX_CONCURRENT=1` (una grabación a la vez) y observar métricas/logs
  durante la reunión de prueba; ajustar recursos del servicio si hace falta.
