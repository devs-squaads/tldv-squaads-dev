# Tech stack y convenciones

> Cómo está construido el proyecto y las reglas que **todo el código debe respetar**. Ningún plan de
> feature debería contradecir este archivo. Es la LEY del proyecto.

## Tecnologías

- **Lenguaje:** TypeScript (v5), estricto.
- **Runtime / gestor:** **Bun** (workspaces). Se usa `bun install`, `bun add`, `bun run` — nunca `npm`.
- **Framework web:** Next.js 16 (App Router) + React 19, Route Handlers y Server Actions en `apps/web`.
- **Worker multimedia:** Puppeteer + `puppeteer-extra-plugin-stealth`, FFmpeg, Xvfb + PulseAudio (Docker Linux).
- **Base de datos:** PostgreSQL/Supabase vía **Drizzle ORM** + driver `pg`. `meetings` es la cola y el estado.
- **Almacenamiento:** S3 / MinIO (contrato `StorageProvider`) para los archivos de grabación.
- **IA:** Transcripción Groq Whisper (`whisper-large-v3`, fallback Deepgram); resumen Gemini
  (`gemini-3.1-flash-lite`, fallback Groq `llama-3.1-8b-instant` u OpenAI). Solo en el worker.
- **Estilos:** Tailwind CSS + shadcn/ui.
- **Contenedores / infra:** Docker + Docker Compose. Compose unificado para desarrollo (`docker-compose.yml`)
  y composes por servicio (`docker-compose.{web,worker,postgres,minio}.yml`), con `Dockerfile.web`/`Dockerfile.worker`.
- **CI/CD:** CI vía `.github/workflows/ci.yml` (job `CI / validate`: tests, lint, typecheck, build de
  `Dockerfile.worker`) sobre pushes y PRs de `dev` y `main`. `.github/workflows/main-pr-source-guard.yml`
  exige que todo PR a `main` venga de `dev` del mismo repo. CD del worker **solo** desde `main` vía Railway
  (`railway.json`, Wait for CI gates, `GET /health` = `200`). `dev` corre CI pero **nunca** despliega. El
  `web` va en Vercel. Detalle en `docs/deployment.md`.

> **Versiones y docs actualizadas = Context7.** La fuente de verdad para la versión y la API real de cualquier
> librería/SDK/framework de este stack es **Context7** (MCP `context7`): resolvé la doc antes de asumir una
> versión o firma. No fijes versiones de memoria — el `package.json` manda para lo instalado y Context7 para la
> doc vigente.

## Archivos / módulos clave

- `apps/web/src` — superficie Next.js y lógica exclusiva del servicio web (UI, API, server actions).
- `apps/worker/src` — runner, bot y pipeline operativo del worker.
- `apps/worker/src/bot` — "el cerebro" del bot (Puppeteer + stealth).
- `apps/worker/src/runner.ts` — loop de reclamo de reuniones con heartbeat/backoff (saga/retry).
- `packages/shared/src` — dominio, contratos y lógica realmente compartida entre roles.
- `packages/shared/src/db` — conexión (`index.ts`) y esquema Drizzle (`schema.ts`).
- `packages/shared/src/integrations/storage` — `StorageProvider` + `S3StorageProvider` + factory.
- `apps/extension/src` — source of truth de la extensión (se compila a `apps/extension/dist`).

## Levantar el proyecto (desarrollo local)

Camino recomendado: **infra + worker en Docker, web nativa**. El `web` corre nativo (hot reload rápido);
la infra (Postgres + MinIO) y el `worker` van en Docker, porque la captura del worker necesita
Linux + Xvfb + FFmpeg. El `docker compose up -d` completo NO se usa en dev: el runtime del `web` es
Node-only y su modo dev requiere Bun (ver `Dockerfile.web`).

**Requisitos:** Bun instalado en el host, y Docker + Docker Compose para la infra/worker.

1. **Clonar** y entrar al repo. `bun install`.
2. **Configurar entorno:** copiar `.env.development.example` → `.env.development` y rellenar las claves
   reales (Google OAuth, GROQ/GEMINI, S3, etc.). El `.env` base ya trae los valores genéricos.
3. **Levantar dev:** `bun run dev` — arranca infra + worker en Docker (`infra:up`) y la web nativa.
   Los scripts nativos cargan `.env` + `.env.development` de raíz con `bun --env-file`. Como la app
   nativa no está en la red Docker, `dev:web`/`dev:worker` apuntan la DB y el storage a `localhost`
   (override inline en el script; los contenedores siguen usando los hostnames `postgres`/`minio`).
4. **Verificar:** web en `http://localhost:3000`, MinIO console en `http://localhost:9001`. Logs de la
   infra: `bun run infra:logs`.
5. **Apagar:** `bun run infra:down` (`bun run infra:reset` borra los volúmenes de DB/MinIO y relevanta).

> Detalle completo (despliegue separado por servicio, producción, variables): `README.md`.

### Probar el web local contra el worker desplegado

Caso de uso: correr **solo el web en local** pero apuntando al **worker de development ya desplegado**
(`worker-tldv-dev.server.squaads.com`), sin levantar el worker en tu máquina. Útil para validar el flujo
web→worker (`reprocess`, `retry`, `refine-summary`, `auto-join/poll`) contra el entorno real.

- El mecanismo es la variable **`WORKER_INTERNAL_BASE_URL`**, que el web usa en
  `apps/web/src/services/workerRecoveryClient.ts` para las llamadas servidor-a-servidor al worker. Apuntala al
  subdominio del worker desplegado (el `-dev`).
- Para eso existe el override **`.env.development.remote`** (gitignored, con secretos reales — nunca se versiona).
- **Atajo:** `bun run dev:remote` arranca la web nativa cargando `.env` + `.env.development.remote`
  (worker/DB/MinIO remotos). No levanta infra local ni depende de ningún compose.

> ⚠️ Apunta a infraestructura **dev compartida** (DB Supabase, MinIO y worker de development). No es un sandbox
> aislado: lo que hagas impacta ese entorno.

## Comandos

| Comando | Para qué |
|---|---|
| `bun run dev` | Modo dev: infra + worker en Docker + web nativa (hot reload). |
| `bun run dev:remote` | Web nativa contra el worker desplegado (`-dev`); usa `.env.development.remote`. |
| `bun run infra:up` | Infra en Docker: postgres + minio + worker. |
| `bun run infra:down` | Apagar la infra (`bun run infra:reset` borra volúmenes DB/MinIO y relevanta). |
| `bun run infra:logs` | Logs del stack Docker. |
| `bun install` | Instalar dependencias (workspaces). |
| `bun run dev:web` | Solo la web nativa (carga el env de raíz). |
| `bun run dev:worker` | Solo el worker nativo (carga el env de raíz). |
| `bun test apps/__tests__` | Ejecutar la suite de tests. |
| `bun run typecheck` | Chequeo de tipos (todos los workspaces). |
| `bun run lint` | ESLint sobre los paquetes. |
| `bun run build:web` | Build de producción del web (fuerza `NODE_ENV=production`). |
| `bun run extension:build` | Compilar la extensión y regenerar el ZIP interno. |

## Modelo de datos / dominio

Persistencia (mapa verificado): **el texto y la metadata viven en DB; el video `.mp4` vive en S3; la DB solo
guarda la `key` del objeto, nunca el binario.** Dev usa Postgres local (compose); prod usa Supabase como
Postgres gestionado (mismo `DATABASE_URL`, SSL automático si el host es `*.supabase.co`).

- `meetings` — cola de trabajo y estado transaccional. Estados: `pending → joining → waiting_admission →
  recording → transcribing → summarizing → completed`; cualquier estado activo puede ir a `error`/`rejected`.
  Guarda `rawTranscription`, `summary` y `recordingFilePath` (la key en S3).
- `users` — usuarios + tokens Google OAuth (access/refresh) + `calendarEnabled`.
- `chat_messages` — historial del chat asistente (`role` = `user|assistant`).
- `meeting_shares` + `meeting_share_access_logs` — compartición: token/OTP hashes, expiración, auditoría.
- `settings` — configuración key/value.

> Regla de cola: el worker debe reclamar y pasar a `recording` **antes** de iniciar Puppeteer/FFmpeg.

## Convenciones

- **Cero acoplamiento a proveedores:** si aparece un `if/switch` por proveedor/SDK en orquestación, servicio,
  UI o controlador, el diseño es incorrecto. Variación nueva → **extender el contrato** (`interface` /
  `abstract class` / factory), no hardcodear. Ámbito: `CalendarProvider`, `MeetingProvider`, `StorageProvider`,
  `SharingProvider`, `TranscriptionProvider`, `SummaryProvider`, `EmailProvider`.
- **Paquetes/rutas por rol:** lógica web-only → `apps/web/src`; worker-only → `apps/worker/src`; compartida
  real → `packages/shared/src`. Si no es compartida, **prohibido** ponerla en `shared`.
- **API-first multicliente:** todo caso de uso reutilizable se implementa en backend con rutas API estables;
  los clientes (web, extensión) las consumen sin duplicar dominio.
- **Naming de sharing:** específico de web → `apps/web/src/integrations/sharing`; reutilizable → mover a
  `packages/shared/src/integrations/sharing`. Mantener patrón contratos/factory.
- **Sincronización de env docs (obligatoria):** al añadir/quitar/cambiar una variable de entorno funcional,
  actualizar en el mismo bloque `README.md` (sección Variables) y los `.env.*.example` correspondientes.
- **Compartición con caducidad opcional:** sin TTL → enlace sin expiración (`expires_at = null`). La validación
  de expiración/revocación vive en backend.
- **Paso a paso sin regresiones:** no romper funcionalidad ya operativa para arreglar un paso posterior; si algo
  ya funciona, no se modifica su base salvo necesidad justificada y verificada.
- **Señalar incompatibilidades:** ante un riesgo técnico/seguridad o violación del diseño, detenerse e informar
  antes de continuar.

## Testing (TDD obligatorio)

> Regla mandatoria del SDD. El objetivo es que cualquier dev **o modelo de IA** que trabaje el proyecto sea
> capaz de **autovalidarse** y entregar exactamente lo pedido, no "lo que parece que funciona".

- **TDD obligatorio para lógica (RED → GREEN → REFACTOR):** toda implementación nueva o cambio de comportamiento
  empieza por un test que **falla**, luego el código mínimo que lo pone en **verde**, luego refactor con la
  suite en verde. Un cambio de lógica sin su test es un cambio **incompleto** y no se mergea.
- **Ámbito del TDD:** dominio (`packages/shared`), servicios, repositorios, Route Handlers / Server Actions,
  policies del chat (tool-policy, trust boundary) y utilidades. Es donde vive el comportamiento verificable.
- **Excepciones (validación por integración/manual, NO unit TDD):** captura multimedia del worker
  (Puppeteer + FFmpeg) y UI puramente visual/estilos. No se fuerza unit test donde no aporta señal real; se
  validan end-to-end o a mano, y se deja registrado cómo se validó.
- **Carpeta espejo (`apps/__tests__/`):** todos los tests están **centralizados** ahí, replicando la
  **app + área** del código bajo prueba, no la ruta `src/…` completa:
  `apps/<app>/src/<área>/<nombre>.ts` → `apps/__tests__/<app>/<área>/<nombre>.test.ts`
  (ej. `apps/web/src/modules/chat/http/trustBoundary.ts` → `apps/__tests__/web/modules/trustBoundary.test.ts`;
  `apps/worker/src/shared/auto-join-service.ts` → `apps/__tests__/worker/shared/auto-join-service.test.ts`).
  Primer segmento = app (`web`/`worker`); luego el área (`modules`, `repositories`, `routes`, `shared`, `bot`,
  `extension`). **Prohibido** dispersar tests junto al código fuente.
- **Runner y naming:** Bun, archivos `*.test.ts`. Suite: `bun test apps/__tests__` (debe pasar antes de cada
  commit).
- **En el ciclo SDD:** `tasks.md` de cada feature lista primero las tareas de test (rojo) y luego las de
  implementación (verde); la feature no pasa a "Hecho" sin su cobertura de lógica en verde.

## Estilo visual

- Tailwind CSS + shadcn/ui como sistema base de componentes y tokens.

## Límites duros

_Lo que NUNCA se debe hacer._

- **bun-only:** nada de `npm`/`yarn` para gestión o scripts.
- **Almacenamiento único Postgres** en producción (Supabase/PG). No depender de SQLite en prod.
- **NO usar extensiones de Chrome ni `puppeteer-stream` como motor de grabación.** La captura es exclusivamente
  FFmpeg a nivel sistema. (Una extensión SÍ puede ser capa de presentación/cliente.)
- **SSOT de variables en compose:** prohibido sobreescribir env en `docker-compose*.yml` con defaults (`:-`),
  hardcodes o duplicados de negocio. La verdad es `.env` + override por entorno. Compose solo fija flags
  estructurales (`ROLE`, `NODE_ENV`, `IS_DOCKER`).
- **NUNCA pushear directo a `dev` o `main`.** Trabajá en ramas feature y mergeá por PR. `dev` corre CI pero
  **nunca** despliega; `main` es la **única** rama de deploy (Railway CD, con Wait for CI gates y `/health`).
- **No tocar el contrato de despliegue sin alerta explícita** al dev: `Dockerfile.web` / `Dockerfile.worker`,
  `docker-compose*.yml`, `railway.json` y `.github/workflows/*.yml` (`ci.yml`, `main-pr-source-guard.yml`).
  Antes de tocarlos, revisar si la lógica pertenece a `web/worker/shared`.
- **No mezclar rol `web` y `worker`** en la misma instancia de producción; no acoplar DB/S3 dentro de esos hosts.
- **No subir `.env*` reales al repo** (solo los `.example`).
