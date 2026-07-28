# Contexto de deployment — repo `tldv-squaads-dev`

> Mapa operativo del ambiente de desarrollo remoto: qué corre dónde, cómo se despliega cada pieza y qué
> queda pendiente. Actualizado: **16/07/2026**. Decisión de fondo en
> [`docs/adr/0001-worker-railway-dev.md`](adr/0001-worker-railway-dev.md).

## Mapa de ambientes

| Componente | Plataforma | Identificador | Deploy |
|---|---|---|---|
| Web (Next.js) | Vercel | `devssquaads-projects/tldv-squaads-dev` → https://tldv-squaads-dev.vercel.app | Automático por git (integración GitHub) |
| Worker (Puppeteer + FFmpeg) | Railway | proyecto `TLDV-DEV` / env `dev-remote` / servicio `worker` → https://worker-dev-remote.up.railway.app | CD desde `main`, bloqueado hasta completar las gates de activación |
| Base de datos | Supabase (dedicada dev) | project ref `ljerzkktmzrpiwsahkvp` (pooler `aws-0-eu-west-1`, puerto 5432) | Gestionada |
| Video (S3) | Railway Bucket | `tldv-meetings-dev-wlwoxrq` @ `https://t3.storageapi.dev` | Gestionado |

> El project ref `jgycakobknhfsdsufcxd` que aparece en `.mcp.json` es la Supabase **vieja** (solo lectura
> para consultas MCP). La cola viva de dev es la dedicada (`ljer…`). No mezclarlas en `DATABASE_URL`.

## Estrategia de ramas

- **`dev`** — integración sin autoridad de release del worker. CI valida pushes y PRs; Railway nunca
  despliega esta rama. En Vercel puede generar **Previews**.
- **`main`** — **prod-dev** (simulación de producción). Debe ser la **Production Branch** del proyecto
  Vercel: push/merge a `main` → deploy de Producción en `tldv-squaads-dev.vercel.app`. Es la rama por
  defecto del repositorio y la única que puede originar un release del worker en Railway.
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
- **Email (ADR-0004, feature 013)** — `EMAIL_PROVIDER=smtp` + `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
  `SMTP_PASS`/`SMTP_FROM` van en **Vercel** (proyecto `web`), no en Railway: `SmtpEmailProvider` vive
  enteramente en `apps/web/src/integrations/email/providers/SmtpEmailProvider.ts` — el worker no lo
  referencia en ningún punto. Si esta configuración falta o está incompleta con `NODE_ENV=production`,
  `SmtpEmailProvider` **bloquea el envío lanzando un error explícito** en vez de degradar a log de consola
  — deben quedar cargadas en Vercel antes de mergear a `main`/desplegar, no después.
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
- Puerto: el listener resuelve primero el `PORT` válido inyectado por Railway, después un
  `WORKER_INTERNAL_PORT` válido y, si ninguno es un entero decimal entre `1` y `65535`, usa `4000`. `railway.json` fija
  `/health`, 60 segundos de timeout y reinicio `ON_FAILURE` con 10 reintentos.

## CI/CD

- **Web:** automático. Push a la Production Branch → Producción; push a otras ramas → Preview.
- **Validación del repositorio:** `.github/workflows/ci.yml` publica el check estable `CI / validate`
  para pushes y PRs de `dev` y `main`. Ejecuta instalación congelada, tests, lint, typecheck y build de
  `Dockerfile.worker` desde la raíz. No despliega ni usa secretos.
- **Worker:** Railway es la única autoridad de CD. Solo un push elegible a `main`, para el mismo SHA con
  `CI / validate` verde, puede desplegar. `dev` nunca despliega.

### Release flow (feature → dev → main → Railway)

1. Rama feature desde `dev` (nunca directo sobre `dev`/`main`).
2. PR feature → `dev`. CI corre `CI / validate` (tests, lint, typecheck, Docker build).
3. Merge a `dev` tras CI verde + revisión. `dev` **nunca** despliega.
4. PR `dev` → `main`. **Gobernanza:** requiere aprobación de `devs-squaads`.
5. `Guard main PR source` verifica que el origen sea `dev` del mismo repo; CI corre de nuevo sobre `main`.
6. Merge a `main` tras CI verde + guard.
7. Railway auto-despliega desde `main` (Wait for CI gates). Aceptar el release solo si el deployment termina
   en `SUCCESS` y `GET /health` responde `200`.

> Railway es la única autoridad de CD y rollback. `dev` no tiene autoridad de release del worker.

### Watch scope del worker

Railway debe observar `apps/worker/**`, `packages/shared/**`, `scripts/entrypoint.worker.sh`,
`Dockerfile.worker`, `railway.json`, `.railwayignore`, `package.json`, `bun.lock` y
`tsconfig.base.json`. Un cambio fuera de ese conjunto puede omitir el release; uno dentro no puede
quedar fuera silenciosamente.

### Activación segura

1. Mantener autodeploy desactivado hasta que `main` exija PR y `CI / validate`, y bloquee push directo,
   force-push y borrado.
2. Leer de nuevo en Railway el repo fuente, rama `main`, root `/`, config `/railway.json`, watch scope,
   Dockerfile, Wait for CI, variables de puerto y healthcheck `/health`.
3. Solo después, activar Wait for CI y autodeploy.
4. Aceptar el release únicamente si Railway registra el SHA exacto de `main`, termina en `SUCCESS` y
   `GET /health` responde `200`. Un despliegue bloqueado por CI debe quedar `SKIPPED`.

### Rollback

Desactivar primero autodeploy, restaurar en Railway un deployment conocido como bueno y volver a
comprobar SHA, estado `SUCCESS`, logs, métricas y `/health`. No restaurar automatización VPS.

## Pendientes vivos

- [ ] Gates de activación del CD del worker en Railway (branch protection en `main`, re-verificación de
  la config de Railway, luego habilitar Wait for CI + autodeploy) — ver "Activación segura" arriba.
- [ ] Switch de **Production Branch** a `main` en Vercel (dashboard → Settings → Git) + redeploy.
- [ ] Redirect URIs de Google OAuth para el dominio de Vercel (login bloqueado hasta entonces).
- [ ] Feature 007 (sincronización de estados de la extensión) — abierta, pendiente
  ([`spec/features/007-extension-status-sync/`](../spec/features/007-extension-status-sync/spec.md)).
