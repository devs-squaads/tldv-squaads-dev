# Squaads Meeting Bot

Bot de reuniones para Google Meet y Microsoft Teams que graba audio/video con Puppeteer + FFmpeg, transcribe con Groq Whisper o Deepgram y resume con Gemini, Groq o OpenAI.

> **¿Cómo se trabaja aquí?** Empezá por [`AGENTS.md`](./AGENTS.md) (el cerebro del proyecto) y la carpeta
> [`spec/`](./spec/README.md) (constitución + features del ciclo SDD). Este README es la referencia de información técnica.

## Arquitectura Base
El proyecto usa un unico repositorio con **Bun workspaces** y despliegue dual:
* **Web Role**: `apps/web` (Next.js UI + APIs), sin procesamiento multimedia pesado.
* **Worker Role**: `apps/worker` para procesamiento de reuniones (Puppeteer + FFmpeg + IA).
* **Shared Package**: `packages/shared` con dominio, DB, repositorios e integraciones reutilizables.
* **Postgres**: almacena reuniones/estados; `web` y `worker` comparten la misma cola.
* **S3 / MinIO**: recoge las grabaciones del worker y provee descargas a la UI.
* **Patrones aplicados**:
  * Repository por ownership (`packages/shared/src/repositories/…`, `apps/web/src/repositories/…`, `apps/worker/src/repositories/…`).
  * Shared domain/contracts (`packages/shared/src/*`) + application layers por rol (`apps/web/src/*`, `apps/worker/src/*`).
  * Saga / Retry Pattern para procesos largos (`apps/worker/src/runner.ts` con heartbeat/backoff).

## Contrato Web/Worker
### Responsabilidad del `web`
* Aceptar solicitudes de creacion de reuniones.
* Leer y exponer estado/resultados al dashboard.
* Persistir y consultar metadatos de reuniones.
* No ejecutar captura, transcripcion ni resumen.

### Responsabilidad del `worker`
* Reclamar reuniones `pending`.
* Ejecutar grabacion y pipeline de post-proceso.
* Persistir transicion de estados (`recording`, `transcribing`, `summarizing`, `completed`, `error`).
* Gestionar errores operativos y dejar trazabilidad en DB.

### Interfaz entre roles
* El web escribe reuniones pendientes y consulta estado.
* El worker consume esas pendientes y actualiza el mismo registro.
* Para operaciones pesadas iniciadas desde web (`retry`, `reprocess`, `refine-summary`, `auto-join/poll`), el web delega en la API interna HTTP del worker.
* Ambos roles comparten la misma DB y bucket de grabaciones.

### Contrato de estados compartidos
* Flujo nominal: `pending -> recording -> transcribing -> summarizing -> completed`.
* Flujo de error: cualquier estado activo puede terminar en `error`.
* Regla operativa: el worker debe reclamar y pasar a `recording` antes de iniciar Puppeteer/FFmpeg.

## Pipeline de Grabacion
* **Puppeteer**: Controla la unión a la reunión, navegación y configuración de UI (silencio, entrada de nombre).
* **FFmpeg**: Captura el stream de audio y video a nivel sistema.
* **Xvfb + PulseAudio**: Emula un display y un servidor de sonido en entornos headless (Docker).

## Entorno recomendado (Docker)
Usa `x11grab` y `pulseaudio` dentro de un entorno Linux aislado.

### Desarrollo local

El modo dev corre la **web nativa** (hot reload rápido) y deja **infra + worker en Docker**
(el worker necesita Linux + Xvfb + FFmpeg para la captura multimedia).

```bash
# Modo dev: infra + worker en Docker + web nativa (un comando)
bun run dev

# Web nativa contra el worker YA DESPLEGADO (-dev), sin infra local
bun run dev:remote
```

Control fino de la infra en Docker:

```bash
bun run infra:up      # postgres + minio + worker
bun run infra:logs    # logs del stack Docker
bun run infra:down    # apaga la infra
bun run infra:reset   # borra volúmenes (DB/MinIO) y relevanta
```

> `bun run dev` = `infra:up` + web nativa. La web carga el env de raíz (`.env` + `.env.development`)
> vía `bun --env-file`, ya que fuera de Docker no aplica el `env_file` del compose.

> `docker-compose.yml` carga automáticamente `.env` + `.env.development`.
> En este flujo, `web` corre con hot reload (`next dev`) y `worker` con watch mode (`bun --watch`).

> Si usás auto-join legacy por Service Account en local (`AUTO_JOIN_ENABLED=true`), `docker-compose.yml`
> monta `./resources:/keys:ro` en el worker — colocá el JSON descargado de Google Cloud Console como
> `resources/google_service_account_file.json` (la carpeta está vacía por defecto y no se versiona).
> Sin ese archivo, el worker falla con `ENOENT: .../keys/google_service_account_file.json` al arrancar
> el poll de auto-join.

### Produccion separada por responsabilidad
```bash
# PostgreSQL (solo si no usas servicio gestionado)
docker compose -f docker-compose.postgres.yml up -d

# MinIO/S3 (solo si no usas servicio gestionado)
docker compose -f docker-compose.minio.yml up -d

# Solo web (en su servidor/plataforma)
docker compose -f docker-compose.web.yml up -d meeting-web

# Solo worker (en servidor privado)
docker compose -f docker-compose.worker.yml up -d meeting-worker
```

Artefactos de build por rol:
- `Dockerfile.web`: imagen exclusiva del servicio web, construye `apps/web` y arranca el servidor standalone generado por Next.
- `Dockerfile.worker`: imagen exclusiva del servicio worker.

Todos estos despliegues independientes exigen que el host tenga las variables críticas correctamente definidas en sus archivos `.env*` (el worker necesita `DATABASE_URL` válido y credenciales S3, el web necesita `API_ROUTE_SECRET`, etc.); sin esos valores acordes a la infraestructura remota el arranque fallará.
Los despliegues separados son de estilo producción: no tienen hot reload y los cambios de código exigen rebuild del servicio afectado.

Nombres de contenedor:
- modo desarrollo unificado: `meeting-web`, `meeting-worker`, `meeting-db`, `meeting-storage`, `meeting-storage-mc`.
- modo separado por servicio: `meeting-web-service`, `meeting-worker-service`, `meeting-db-service`, `meeting-storage-service`, `meeting-storage-mc-service`.

### Archivos de entorno y modo de despliegue

El proyecto usa un modelo de configuración basado en overrides por entorno, pero el build de `web` debe ejecutarse siempre mediante `bun run build:web`, ya que ese script fuerza `NODE_ENV=production` para Next.

- `.env`: configuración base compartida (solo nombres y valores genéricos que no exponen claves; los datos sensibles van en los overrides).
- `.env.development.example`: plantilla para desarrollo.
- `.env.production.example`: plantilla para producción.

#### Archivos NO versionados
- `.env.development`: configuración local (se crea a partir de `.env.development.example`).
- `.env.production`: configuración real de producción (se crea a partir de `.env.production.example`).

> ⚠️ IMPORTANTE:
> En despliegues por compose separado, `.env.production` debe existir en cada host donde ejecutes su compose (`web`, `worker`, `postgres`, `minio`).
> Si despliegas `web` en **Vercel**, ahí no se usa `.env.production`: las variables se configuran directamente en la plataforma.

#### Selección de entorno
La selección de entorno queda definida por cómo arranques:
- **Desarrollo:** `bun run dev` — infra/worker en Docker (`docker-compose.yml` → `.env` + `.env.development`) y web nativa que carga esos mismos env con `bun --env-file`.
- **Producción (compose separado):** `docker compose -f docker-compose.web.yml up -d`, `docker compose -f docker-compose.worker.yml up -d`, `docker compose -f docker-compose.postgres.yml up -d`, `docker compose -f docker-compose.minio.yml up -d`: cargan `.env` + `.env.production`.

#### Regla SSOT de variables (obligatoria)
No se debe sobreescribir variables de entorno dentro de `docker-compose*.yml` mediante defaults (`:-`), hardcodes o duplicación de valores de negocio.  
La fuente única de verdad (SSOT) para configuración es el sistema `.env` + override por entorno (`.env.development` o `.env.production`).
Los compose solo pueden fijar flags estrictamente estructurales del servicio (por ejemplo `ROLE`, `NODE_ENV`, `IS_DOCKER`).

#### Regla de validación (fail-fast)
El arranque depende de que las variables requeridas estén definidas en los archivos `.env*` correspondientes al modo. Si faltan variables críticas, los servicios fallarán en build o en runtime.

#### Uso

```bash
bun run dev
```

### Comandos de proyecto

```bash
# Modo dev (recomendado): infra + worker en Docker + web nativa
bun run dev
bun run dev:remote           # web nativa contra el worker desplegado (-dev)

# Infra en Docker (postgres + minio + worker)
bun run infra:up             # levanta la infra en background
bun run infra:logs           # sigue los logs del stack Docker
bun run infra:down           # apaga la infra
bun run infra:reset          # borra volúmenes (DB/MinIO) y relevanta

# Un solo rol nativo (cargan el env de raíz)
bun run dev:web
bun run dev:worker

# TypeScript
bun run typecheck

# Tests
bun test apps/__tests__

# Build de producción del web
bun run build:web
```

## Variables de Entorno Principales
| Variable                                                      | Descripción                                                                                                                                    |
|:--------------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------------------|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`         | Variables del contenedor PostgreSQL local/separado (también usadas por healthchecks).                                                          |
| `DATABASE_URL`                                                | Conexion PostgreSQL/Supabase compartida por `web` y `worker`.                                                                                  |
| `API_ROUTE_SECRET`                                            | Secreto Bearer para proteger rutas API de encolado de reuniones.                                                                               |
| `WORKER_INTERNAL_BASE_URL`                                    | URL base servidor-a-servidor usada por `web` para pedir al `worker` operaciones internas (`reprocess`, `retry`, `refine-summary`, `auto-join/poll`). |
| `DISCORD_BUGREPORT_WEBHOOK_URL`                               | Optional web-only Discord webhook for redacted bug reports. Use `REPLACE_WITH_DISCORD_WEBHOOK_URL`; when unset, reports use the safe console provider. |
| `WORKER_INTERNAL_PORT`                                        | Puerto HTTP interno donde el `worker` expone su API privada servidor-a-servidor (por defecto `4000`).                                        |
| `SHARE_APP_BASE_URL`                                          | URL base pública usada para construir enlaces de compartición (`/share/:token`).                                                               |
| `SHARE_TTL_OPTIONS_MINUTES`                                   | Lista CSV de TTL permitidos (en minutos) para los selectores de creación/renovación de enlaces (ej. `60,1440,10080`).                          |
| `SHARE_SIGNED_URL_TTL_SECONDS`                                | Vida útil (segundos) de la signed URL de grabación al resolver enlaces compartidos.                                                            |
| `SHARE_OTP_LENGTH`                                            | Longitud del código OTP (One-Time Password) para enlaces `restricted_email`.                                                                   |
| `SHARE_OTP_TTL_MINUTES`                                       | Minutos de validez del OTP emitido para verificación de acceso.                                                                                |
| `SHARE_OTP_REQUEST_RATE_LIMIT` / `SHARE_OTP_REQUEST_WINDOW_MS`| Límite y ventana temporal para solicitudes de OTP por share/IP.                                                                                |
| `SHARE_OTP_VERIFY_RATE_LIMIT` / `SHARE_OTP_VERIFY_WINDOW_MS`  | Límite y ventana temporal para intentos de verificación OTP por share/IP.                                                                      |
| `EMAIL_PROVIDER`                                              | Proveedor de email usado para invitaciones, reenvíos y OTP en compartición restringida (`console` por defecto).                                |
| `ROLE`                                                        | Define el rol de proceso (`web` o `worker`) para el split arquitectonico.                                                                      |
| `IS_DOCKER`                                                   | Debe ser `true` para ejecutar worker multimedia en Linux Docker.                                                                               |
| `PUPPETEER_EXECUTABLE_PATH`                                   | Binario de Chromium usado por el bot en Docker (en este repo se setea por Dockerfile).                                                         |
| `DISPLAY` / `PULSE_SERVER`                                    | Variables de runtime multimedia para captura X11 + PulseAudio en el worker Docker.                                                             |
| `STORAGE_PROVIDER`                                            | Backend de almacenamiento (`s3` por defecto).                                                                                                  |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_REGION` | Credenciales y configuración base del bucket.                                                                                                  |
| `WORKER_POLL_INTERVAL_MS`                                     | Intervalo de polling del worker cuando no hay pendientes.                                                                                      |
| `WORKER_MAX_ATTEMPTS`                                         | Reintentos maximos por reunion fallida en el worker.                                                                                           |
| `WORKER_RETRY_BASE_MS`                                        | Base del backoff exponencial entre reintentos (`base * 2^n`).                                                                                  |
| `WORKER_REPORT_EVERY_CYCLES`                                  | Cada cuantos ciclos el worker emite heartbeat operativo en logs.                                                                               |
| `MEETING_ADMISSION_TIMEOUT_MS`                                | Tiempo maximo (ms) de espera de admisión/lobby del bot antes de marcar fallo (Para cualquier provider).                                        |
| `WAIT_FOR_PARTICIPANTS_TIMEOUT_MS`                            | Tiempo maximo (ms) tras la admisión para que aparezcan participantes antes de tratar la reunión como no lista y reintentar el flujo.          |
| `AUTO_JOIN_ENABLED`                                           | Activa/desactiva el auto-join desde calendario en el worker.                                                                                   |
| `AUTO_JOIN_ORGANIZER_EMAILS`                                  | Lista CSV permitida para filtrar eventos por `organizer.email` o `creator.email`.                                                              |
| `AUTO_JOIN_PROVIDER`                                          | Proveedor de calendario para auto-join (`google`).                                                                                             |
| `BOT_DEFAULT_NAME`                                            | Nombre por defecto global del bot cuando la reunión no trae `botName` explícito.                                                              |
| `BOT_ALLOW_CAMERA`                                            | Si `true`, concede permiso de cámara al navegador del bot. Default recomendado: `false`.                                                      |
| `BOT_ALLOW_MICROPHONE`                                        | Si `true`, concede permiso de micrófono al navegador del bot. Default recomendado: `false`.                                                   |
| `BOT_USE_FAKE_MEDIA`                                          | Si `true`, activa dispositivos fake de Chromium (solo aplica cuando cámara o micrófono están habilitados).                                   |
| `AUTO_JOIN_POLL_INTERVAL_MS`                                  | Frecuencia de consulta del calendario en el worker.                                                                                            |
| `AUTO_JOIN_LEAD_TIME_MINUTES`                                 | Antelacion para encolar una reunion antes de su inicio.                                                                                        |
| `AUTO_JOIN_LOOKBACK_MINUTES` / `AUTO_JOIN_LOOKAHEAD_MINUTES`  | Ventana temporal a consultar en Google Calendar.                                                                                               |
| `AUTO_JOIN_DEFAULT_DURATION_MINUTES`                          | Duración fallback cuando el evento no trae hora fin.                                                                                           |
| `AUTO_JOIN_REQUIRE_SUPPORTED_LINK`                            | Si `true`, solo encola links soportados (Google Meet / Microsoft Teams).                                                                       |
| `NODE_ENV`                                                    | `development` activa el flujo de desarrollo; `production` se usa en despliegues separados y builds de contenedor. **No la fijes a mano en archivos que corren `next dev`** (ej. `.env.development.remote`) — Next.js la autoasigna `development` si no está seteada; forzarla a `production` ahí dispara el warning "non-standard NODE_ENV" y activa lógica de producción (ej. cookies `secure`) sobre un server de desarrollo. |
| `TARGET_ENV`                                                  | Solo informativa/documental: usada en `.env.development.remote` (`TARGET_ENV=remote`) para señalar que la web nativa apunta al worker desplegado en vez de a infra local. No la lee ningún código todavía; existe para no reutilizar `NODE_ENV` con ese propósito.                          |
| `S3_ENDPOINT`                                                 | Endpoint interno para subida desde contenedor (`http://minio:9000` en compose local).                                                          |
| `S3_PUBLIC_ENDPOINT`                                          | Endpoint público para URLs firmadas/descarga desde cliente (`http://localhost:9000` en local).                                                 |
| `GOOGLE_SERVICE_ACCOUNT_FILE`                                 | Ruta al JSON de Service Account montado en el contenedor worker.                                                                               |
| `GOOGLE_SERVICE_ACCOUNT_FILE_HOST`                            | Ruta en el host del archivo JSON usado para montar `/keys/google_service_account_file.json` en el worker separado.                             |
| `GOOGLE_SERVICE_ACCOUNT_JSON`                                 | JSON completo de la Service Account como string; reemplaza a `GOOGLE_SERVICE_ACCOUNT_FILE` en el contexto CI/CD del servidor Squaads donde no hay filesystem compartido. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                   | Credenciales OAuth de Google para login de usuarios y lectura de calendario con tokens delegados.                                              |
| `NEXTAUTH_SECRET`                                             | Secreto de sesión usado por NextAuth para proteger login y cookies de autenticación.                                                           |
| `SUPER_ADMIN_EMAILS`                                          | Emails separados por coma que se autoprovisionan como `admin` activo en `authorized_accounts` la primera vez que inician sesión (bootstrap sin pasos manuales de DB). |
| `GOOGLE_CALENDAR_ID`                                          | Calendar ID a consultar (`primary` si no se define).                                                                                           |
| `GOOGLE_CALENDAR_IMPERSONATE_USER`                            | Opcional: solo para Domain-Wide Delegation (Google Workspace). Si el calendario se comparte con la Service Account, dejar vacío.               |
| `GROQ_API_KEY`                                                | Proveedor principal de transcripción (Whisper) y primera opción actual en resumen del worker (Llama).                                          |
| `GEMINI_API_KEY`                                              | Fallback actual de resumen en worker y proveedor de chat cuando se selecciona `CHAT_PROVIDER=gemini`.                                          |
| `OPENAI_API_KEY`                                              | Fallback opcional adicional para resumen.                                                                                                      |

### Resumen IA (worker): orden actual de providers

- En el pipeline actual del worker, `generateSummary()` intenta **Groq primero** y usa **Gemini como fallback**.
- Si ambos fallan o no están configurados, el resumen falla con error explícito de provider no configurado.

## Chat runtime operativo (provider + policy)

### Resolución efectiva del provider del chat

- `CHAT_PROVIDER` es opcional. Si está definido y es válido (`gemini` o `groq`), manda como provider principal del chat.
- Si `CHAT_PROVIDER` no está definido, el chat autodetecta en este orden: `gemini` si hay `GEMINI_API_KEY`, luego `groq` si hay `GROQ_API_KEY`.
- Si existen credenciales del provider alternativo, el runtime mantiene fallback automático durante el stream para no romper SSE/UX.
- `get_system_status` reporta el provider efectivo real, el fallback disponible y el origen de resolución (`configured`, `auto`, `none`, `invalid-configured`).

### Policy operativa de tools del chat

- `CHAT_TOOL_POLICY` controla explícitamente qué toolset puede usar `/api/chat`.
- Valores soportados hoy:
  - `read-only` → default seguro. Solo habilita tools no mutantes.
  - `full` → habilita también tools mutantes existentes.
- Si `CHAT_TOOL_POLICY` no está definida, el runtime conserva compatibilidad legacy con `CHAT_ENABLE_MUTATING_TOOLS`:
  - `true` → equivale a `full`
  - `false` → equivale a `read-only`
- Si `CHAT_TOOL_POLICY` tiene un valor inválido, el runtime cae a `read-only` por seguridad.
- `get_system_status` también reporta la policy efectiva, el origen de resolución y las tools permitidas/bloqueadas.

### Estado actual de tools mutantes

- Tools read-only: `search_meetings`, `get_meeting_detail`, `get_system_status`.
- Tools mutantes existentes: `enqueue_meeting`, `manage_meeting_share`.
- Las mutantes siguen DESHABILITADAS por defecto. Solo se habilitan con `CHAT_TOOL_POLICY=full` o, por compatibilidad legacy, con `CHAT_ENABLE_MUTATING_TOOLS=true` mientras esa variable siga presente.

### Relación con Observability V2

- Este hardening deja trazables el provider y la policy efectivos para que Track 1A/1B pueda emitir logs estructurados coherentes sin reabrir lógica de negocio.
- El contrato HTTP público del chat sigue cerrado a `user | assistant`; `chatHistory` del cliente sigue siendo hint y el historial server-side confiable sigue saliendo de `ChatMessageRepository`.
- `/api/support` TODAVÍA no está abierto y, cuando exista, no va a confiar ciegamente en `chatHistory` del cliente.
- `/api/metrics` TODAVÍA no está expuesto en esta etapa.
- Variables futuras de Observability V2 como `LOG_LEVEL`, `SUPPORT_RATE_LIMIT_*`, `DISCORD_SUPPORT_WEBHOOK_URL` y `METRICS_API_KEY` siguen documentadas como trabajo futuro: no están activas en esta etapa y no deben asumirse operativas todavía.

## Despliegue dual recomendado (Produccion)
### `web` en Vercel
* Desplegar la app Next con `ROLE=web`.
* Configurar `DATABASE_URL`, `API_ROUTE_SECRET`, `WORKER_INTERNAL_BASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `SUPER_ADMIN_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y variables de lectura necesarias.
* Configurar también el bloque de storage (`STORAGE_PROVIDER=s3` + `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`): el `web` firma las URLs de reproducción/descarga de grabaciones con su propio entorno — sin estas variables el video no se puede ver desde la web.
* La configuración de build vive versionada en `apps/web/vercel.json` (Root Directory del proyecto Vercel = `apps/web`; la instalación corre desde la raíz del workspace de Bun).
* El `web` solo encola reuniones y consulta estado; no ejecuta FFmpeg/Puppeteer.

> **Este repo (`-dev`):** el worker de development corre en **Railway** y el web en **Vercel** — mapa
> operativo completo, variables e instrucciones de deploy en [`docs/deployment.md`](docs/deployment.md)
> (decisión en [`docs/adr/0001-worker-railway-dev.md`](docs/adr/0001-worker-railway-dev.md)). Los
> workflows `deploy-{development,production}.yml` y `deploy.sh` heredados del VPS están **inactivos para
> este repo** (fallan por secrets ausentes); se retiran en la ronda de CI/CD (`chore/railway-cicd`). Lo
> que sigue abajo describe el despliegue clásico en VPS, vigente para el repo/worker de producción.

### `worker` en servidor privado Docker
* Desplegar el mismo repo con `ROLE=worker` y stack multimedia habilitado.
* Variables minimas: `DATABASE_URL`, `API_ROUTE_SECRET`, `WORKER_INTERNAL_PORT`, `IS_DOCKER=true`, `PUPPETEER_EXECUTABLE_PATH`, `S3_*`, `GROQ_API_KEY` y/o `GEMINI_API_KEY`.
* Si usas auto-join legacy por Service Account, define también `GOOGLE_SERVICE_ACCOUNT_FILE_HOST` apuntando al JSON real del host para montarlo en `/keys/google_service_account_file.json`.
* Mantener conectividad de red hacia la misma DB y el mismo bucket que usa el `web`.
* Usar `docker-compose.worker.yml` para arrancar solo el worker. Este archivo no define Postgres ni MinIO locales.
* Ajustar `DATABASE_URL` y `S3_*` para apuntar a infraestructura compartida (DB y S3 externos/remotos).
* El `worker` expone una API privada servidor-a-servidor para que `web` pueda solicitar `reprocess`, `retry`, `refine-summary` y `auto-join/poll` sin importar código del worker.

### Auto-join por calendario (worker)
* El auto-join se ejecuta solo en `worker`.
* Puede operar con usuarios autenticados por OAuth (calendarios propios habilitados) o con Service Account legacy (`AUTO_JOIN_ENABLED=true`).
* `AUTO_JOIN_ORGANIZER_EMAILS` sigue siendo el filtro recomendado para el modo legacy; con OAuth puede dejarse vacío para usar el calendario del usuario autenticado.
* El worker consulta Google Calendar y encola reuniones con enlace Meet/Teams/Zoom (si `AUTO_JOIN_REQUIRE_SUPPORTED_LINK=true`).
* Dedupe por `source_provider + source_event_id` para evitar encolado duplicado del mismo evento.
* El modo OAuth por-usuario se habilita desde Ajustes → "Conectar Calendario" (`apps/web/src/app/api/settings/calendar-connect`). Dos cosas a tener en cuenta al configurar un ambiente nuevo:
  1. Hay que registrar `{NEXTAUTH_URL}/api/settings/calendar-connect/callback` como Authorized redirect URI en Google Cloud Console (Credentials → el mismo OAuth Client ID), además del ya existente `{NEXTAUTH_URL}/api/auth/callback/google` de NextAuth — si falta, Google devuelve `Error 400: redirect_uri_mismatch`.
  2. Ese flujo pide `calendar.readonly` (scope sensible), así que Google va a mostrar el interstitial de "app no verificada" — una vez por usuario que conecta su calendario. Es esperado, no un bug; está avisado en la propia UI del botón. Eliminarlo del todo requiere branding/verificación en Google Cloud Console (spec `002-auth-scope-allowlist`).

### `bbdd` (PostgreSQL/Supabase) separada
* Ejecutar en su propio servidor o servicio gestionado.
* Debe ser la misma DB para `web` y `worker`.
* Si auto-hosting: usar `docker-compose.postgres.yml`.

### `s3` (MinIO/S3) separado
* Ejecutar en su propio servidor o servicio gestionado.
* Debe ser el mismo bucket para `web` y `worker`.
* Si auto-hosting: usar `docker-compose.minio.yml`.

### Contrato operativo entre despliegues
* Ambos roles usan la misma tabla `meetings` como cola de trabajo.
* El `web` crea `pending`; el `worker` reclama y avanza estados.
* No mezclar rol `web` y `worker` en la misma instancia de produccion.
* No acoplar `db` o `s3` dentro de los hosts de `web`/`worker` en produccion.

## Seguridad de la base de datos (RLS)

* La conexión a Postgres/Supabase se hace **siempre** vía `DATABASE_URL` (driver `pg` de Drizzle), con
  credenciales de servidor. Ni `web` ni `worker` usan `@supabase/supabase-js` ni la `anon key` pública —
  no hay tráfico de browser directo contra la API REST/GraphQL de Supabase (PostgREST).
* Aun así, cualquier proyecto Supabase expone esa API REST por defecto con la `anon key`, sin importar si
  la app la usa. **Row Level Security (RLS)** es el mecanismo de Postgres que filtra el acceso fila por
  fila a nivel de motor de base de datos — es la barrera real si esa key llegara a filtrarse o si algún
  cliente (extensión, futuro frontend) empezara a usarla directamente.
* Estado actual (confirmado vía advisor de seguridad de Supabase, 2026-07-08): RLS **deshabilitado**
  (`ERROR`) en `chat_messages`, `meetings`, `users`, `settings`, `meeting_shares`,
  `meeting_share_access_logs`. `authorized_accounts` tiene RLS **habilitado pero sin políticas** (`INFO`)
  — ese estado bloquea todo acceso vía PostgREST por default, es el comportamiento seguro.
* No es una explotación activa hoy (no hay `anon key` en uso en el código), pero es una superficie
  latente. Ítem de seguimiento en [`spec/constitution/roadmap.md`](spec/constitution/roadmap.md).

### Migraciones aplicadas a mano en Supabase

* El journal de Drizzle (`drizzle/meta/_journal.json`) solo tiene registrada la migración `0000` —
  las migraciones `0001`-`0004` se escribieron a mano y nunca pasaron por `drizzle-kit generate`.
  Hasta reconstruir esos snapshots faltantes, cualquier migración nueva se escribe a mano en
  `drizzle/` (mismo estilo `--> statement-breakpoint`) y se aplica manualmente en Supabase.
* Convención: cada migración manual se guarda como query **"Shared"** en el SQL Editor de Supabase
  con el mismo nombre que el archivo (ej. `0005_enable_rls` ↔ `drizzle/0005_enable_rls.sql`), para
  trazabilidad 1:1 entre lo versionado en git y lo ejecutado en el dashboard.
* Esas queries guardadas viven en el dashboard del proyecto Supabase puntual donde se guardaron
  (dev-remote) — no está confirmado que se compartan con producción (sin evidencia de branching
  configurado). Al desplegar a producción, volver a pegar/guardar la query ahí.

## Sharing API-First (web + clientes externos)
El proyecto expone una capa de compartición reutilizable por `meeting-web` y otros clientes (ej. extensión Chrome):
- Tipos de share: `public` y `restricted_email`.
- Caducidad opcional: si no se define TTL, el enlace no expira (`expires_at = null`).
- En `restricted_email` se exige verificación OTP.
- El bucket debe permanecer privado; la descarga se resuelve por signed URLs temporales.

### Endpoints principales
- Privados (requieren `API_ROUTE_SECRET` cuando está configurado):
  - `GET /api/v1/shares` (metadatos de compartición, incluye `ttlOptionsMinutes`)
  - `POST /api/v1/shares`
  - `GET /api/v1/meetings/:meetingId/shares`
  - `DELETE /api/v1/shares/:shareId`
  - `POST /api/v1/shares/:shareId/resend`
- Públicos:
  - `GET /api/v1/public/shares/:token`
  - `POST /api/v1/public/shares/:token/request-access`
  - `POST /api/v1/public/shares/:token/verify-access`
  - UI pública: `GET /share/:token`

## Extensión Chrome (flujo recomendado)

La extensión sigue el modelo:

- `apps/extension/src` es la fuente de verdad.
- `apps/extension/dist` es un artefacto generado para runtime.
- Chrome debe cargar la extensión unpacked desde **`apps/extension/dist`**, no desde `apps/extension/src`.

### Build de la extensión

```bash
bun run extension:build
```

Ese comando:
- compila `service-worker`, `content script` y `popup` desde `apps/extension/src`
- copia `manifest.json`, `popup.html`, `popup.css` y assets visuales a `apps/extension/dist`
- genera automaticamente `apps/web/private-downloads/squaads-extension-internal.zip`
- deja lista la carpeta que Chrome puede cargar

### Estado actual de la UX de la extensión

- **Popup con dos vistas**:
  - `Overview`: estado actual del meeting, acciones operativas y restauración del widget flotante.
  - `Configuration`: conexión segura con `linkToken`, nombre por defecto del bot y duración.
- **Widget flotante**:
  - se monta solo dentro de reuniones activas soportadas.
  - se puede arrastrar.
  - recuerda su posición.
  - se puede colapsar y restaurar.
- **Sincronización visual**:
  - popup y widget comparten contrato de estado runtime.
  - el popup oculta `Invite Bot` mientras el bot está en estado activo.
- **Badge de la extensión**:
  - muestra `REC` solo cuando la extensión confirma estado `recording`.
  - limpia el badge cuando desaparecen las tabs de reunión válidas o cuando la UI deja de poder confirmar actividad.
- **Iconografía**:
  - la extensión usa un asset visual propio bajo `apps/extension/assets/squaads-icon.png`.

### Distribución interna y onboarding seguro

- La distribución actual es interna: `apps/web/private-downloads/squaads-extension-internal.zip`.
- La web expone `GET /downloads/squaads-extension-internal.zip`.
- El onboarding seguro usa:
  - `POST /api/v1/extension/link-token`
  - `POST /api/v1/extension/connect`
  - endpoints versionados bajo `/api/v1/extension/*` para la sesión vinculada.
- La lógica de token del onboarding vive en `apps/web/src/services/extensionTokens.ts`.

### Flujo de trabajo

1. Editar archivos en `apps/extension/src`
2. Ejecutar `bun run extension:build`
3. En Chrome, recargar la extensión unpacked apuntando a `apps/extension/dist`
4. Refrescar la pestaña del meeting antes de probar

### Regla operativa

No editar `apps/extension/dist` manualmente salvo emergencia de diagnóstico. Los cambios permanentes deben hacerse en `apps/extension/src` y luego regenerar `dist`.

### Nota de debugging

Si Chrome sigue mostrando una UI o icono viejo después de cambios en `src`:

1. ejecutar `bun run extension:build`
2. recargar la extensión unpacked desde `apps/extension/dist`
3. refrescar la pestaña del meeting

En esta extensión, probar `src` sin regenerar `dist` lleva a diagnósticos falsos.

## Estructura del Proyecto
* `/apps/web/src`: superficie Next.js y lógica exclusiva del servicio web.
* `/apps/web/src/app`: App Router de Next.
* `/apps/web/src/components`: componentes UI de la web.
* `/apps/worker/src`: runner, bot y lógica operativa del worker.
* `/packages/shared/src`: dominio, DB, repositorios e integraciones realmente compartidas.
* `/apps/extension/src`: source of truth de la extensión.
* `/scripts/entrypoint.web.sh`: Arranque dedicado del servicio `web`.
* `/scripts/entrypoint.worker.sh`: Arranque dedicado del servicio `worker`, incluyendo stack multimedia Docker.
* `/docker-compose.yml`: Orquestación conjunta para desarrollo.
* `/docker-compose.web.yml` y `/docker-compose.worker.yml`: despliegue separado por rol.

## Despliegue automatizado del worker al servidor Squaads

El worker se despliega automáticamente al servidor Squaads desde GitHub Actions:
- Push a rama `dev` → deploy a entorno development (`worker-tldv-dev.server.squaads.com`).
- Push a rama `main` → deploy a production con approval manual en GitHub Environments (`worker-tldv.server.squaads.com`).

El web vive en Vercel y se despliega por separado. DB (Supabase) y S3 son servicios gestionados externos.

### Setup inicial (una vez)
1. Configurar secrets en GitHub Settings → Environments (`development` y `production`). Para cada environment, crear las variables listadas en `.env.dev.example` / `.env.prod.example`.
2. Añadir en Settings → Secrets and variables → Actions: `SSH_PRIVATE_KEY`, `SSH_USER=root`, `SERVER_HOST=server.squaads.com`.
3. En el environment `production`, activar "Required reviewers" para approval manual antes de deploys a main.
4. En el servidor Squaads: verificar que la red Docker `nginx_network` existe (`docker network ls | grep nginx_network`). Si no, crearla: `docker network create nginx_network`.
5. En Nginx Proxy Manager (`server.squaads.com:81`) crear dos Proxy Hosts:
   - `worker-tldv-dev.server.squaads.com` → `meeting-worker-dev:4000` (SSL Let's Encrypt, Force SSL).
   - `worker-tldv.server.squaads.com` → `meeting-worker-prod:4000` (SSL Let's Encrypt, Force SSL).
6. En Vercel (proyecto web): setear `WORKER_INTERNAL_BASE_URL=https://worker-tldv.server.squaads.com` (y la de preview si aplica).

### Deploy manual
Desde el servidor, con el repo en `/root/clients/tldv-squaads/` y `.env.{dev,prod}` generados:
```bash
./deploy.sh development    # o production
```
