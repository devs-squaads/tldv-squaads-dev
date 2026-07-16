# Contexto de deployment — repo `tldv-squaads-dev`

> Mapa operativo del ambiente de desarrollo remoto: qué corre dónde, cómo se despliega cada pieza y qué
> queda pendiente. Actualizado: **16/07/2026**. Decisión de fondo en
> [`docs/adr/0001-worker-railway-dev.md`](adr/0001-worker-railway-dev.md).

## Mapa de ambientes

| Componente | Plataforma | Identificador | Deploy |
|---|---|---|---|
| Web (Next.js) | Vercel | `devssquaads-projects/tldv-squaads-dev` → https://tldv-squaads-dev.vercel.app | Automático por git (integración GitHub) |
| Worker (Puppeteer + FFmpeg) | Railway | proyecto `TLDV-DEV` / env `dev-remote` / servicio `worker` → https://worker-dev-remote.up.railway.app | Manual: `railway up --detach --service worker --environment dev-remote` |
| Base de datos | Supabase (dedicada dev) | project ref `ljerzkktmzrpiwsahkvp` (pooler `aws-0-eu-west-1`, puerto 5432) | Gestionada |
| Video (S3) | Railway Bucket | `tldv-meetings-dev-wlwoxrq` @ `https://t3.storageapi.dev` | Gestionado |

> El project ref `jgycakobknhfsdsufcxd` que aparece en `.mcp.json` es la Supabase **vieja** (solo lectura
> para consultas MCP). La cola viva de dev es la dedicada (`ljer…`). No mezclarlas en `DATABASE_URL`.

## Estrategia de ramas

- **`dev`** — desarrollo. En Vercel genera **Previews** (una URL efímera por push) una vez hecho el
  switch de Production Branch. Todo cambio entra por rama + PR hacia `dev`.
- **`main`** — **prod-dev** (simulación de producción). Debe ser la **Production Branch** del proyecto
  Vercel: push/merge a `main` → deploy de Producción en `tldv-squaads-dev.vercel.app`. Se actualiza
  promoviendo `dev` por PR (ej.: PR #6).
- **Repo heredero** — la aplicación se heredará en otro repositorio antes de producción real. Las
  configs de build viajan versionadas (`apps/web/vercel.json`, `railway.json`), así que el repo nuevo
  solo necesita sus proyectos Vercel/Railway y sus propias variables.

## Web en Vercel

- **Root Directory = `apps/web`** (setting del dashboard). La raíz del repo no tiene dependencias de
  runtime por convención, así que la detección de Next.js falla si el root apunta a la raíz. Bun resuelve
  el workspace igualmente durante `bun install`.
- Config de build versionada en [`apps/web/vercel.json`](../apps/web/vercel.json) — incluye
  `outputDirectory: ".next"` a propósito: pisa un override viejo del dashboard que duplicaba la ruta.
- `.vercelignore` (raíz) excluye worker/extensión/docs del upload.
- **Variables (Production)** — nombres, sin valores: `DATABASE_URL`, `API_ROUTE_SECRET`,
  `WORKER_INTERNAL_BASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPER_ADMIN_EMAILS`, y el bloque de storage
  (`STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
  `S3_ACCESS_KEY`, `S3_SECRET_KEY`). El web **firma las URLs de video con su propio entorno**: sin el
  bloque S3, la reproducción/descarga desde la web no funciona.
- **OAuth de Google** — el dominio nuevo requiere estas Authorized redirect URIs en Google Cloud Console:
  `https://tldv-squaads-dev.vercel.app/api/auth/callback/google` y
  `https://tldv-squaads-dev.vercel.app/api/settings/calendar-connect/callback`.

## Worker en Railway

- Build: `Dockerfile.worker` (builder DOCKERFILE), config en [`railway.json`](../railway.json), upload
  filtrado por [`.railwayignore`](../.railwayignore).
- Variables cargadas en el store de Railway (nombres): `ROLE=worker`, `NODE_ENV`, `IS_DOCKER`,
  `WORKER_INTERNAL_PORT`, `WORKER_MAX_CONCURRENT=1`, `RAILWAY_DOCKERFILE_PATH`, `DATABASE_URL`,
  `API_ROUTE_SECRET`, `GROQ_API_KEY`, `GEMINI_API_KEY`, bloque `S3_*` + `STORAGE_PROVIDER`,
  `WORKER_MAX_ATTEMPTS=3`, `WORKER_RETRY_BASE_MS`. (`SUPER_ADMIN_EMAILS` también está cargada pero es
  variable del web; en el worker no hace nada.)
- Recomendada: `MEETING_ADMISSION_TIMEOUT_MS=600000` — el código tiene dos defaults distintos (20 min en
  el wait genérico, 5 min en el de Meet); definirla explícita unifica el comportamiento.
- Opcionales con default sano (no cargar salvo necesidad): `WORKER_POLL_INTERVAL_MS` (5000),
  `WORKER_REPORT_EVERY_CYCLES` (12), `WAIT_FOR_PARTICIPANTS_TIMEOUT_MS` (300000), `BOT_*`, selectores de
  proveedor IA (vacíos = autodetección), `OPENAI_API_KEY`/`DEEPGRAM_*`, bloque auto-join/Google (solo si
  `AUTO_JOIN_ENABLED=true`; en Railway la credencial va como `GOOGLE_SERVICE_ACCOUNT_JSON`, no `_FILE`).
- Healthcheck: `GET /health` en el dominio público → `200`.

## CI/CD — estado real

- **Web:** automático. Push a la Production Branch → Producción; push a otras ramas → Preview.
- **Worker:** manual (`railway up`). El CI/CD de Railway es trabajo pendiente en la rama
  `chore/railway-cicd`.
- **Workflows heredados del VPS** (`.github/workflows/deploy-{development,production}.yml` + `deploy.sh`):
  **inactivos para este repo** — fallan en ~12s en cada push a `dev`/`main` por secrets SSH ausentes.
  Ruido conocido; se eliminan/reemplazan en la ronda de CI/CD.

## Pendientes vivos

- [ ] Switch de **Production Branch** a `main` en Vercel (dashboard → Settings → Git) + redeploy.
- [ ] Redirect URIs de Google OAuth para el dominio de Vercel (login bloqueado hasta entonces).
- [ ] CI/CD del worker en Railway + retiro de los workflows del VPS (`chore/railway-cicd`).
- [ ] Feature 007 (sincronización de estados de la extensión) — abierta, pendiente
  ([`spec/features/007-extension-status-sync/`](../spec/features/007-extension-status-sync/spec.md)).
