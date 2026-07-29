# Squaads Meeting Bot

Bot self-hosted de reuniones (Google Meet / Microsoft Teams) que graba con Puppeteer + FFmpeg, transcribe y
resume con IA. Para equipos que quieren control y privacidad de sus grabaciones en infraestructura propia.

> Este archivo es el **cerebro** del proyecto: el punto de entrada para cualquier dev o agente, con cualquier
> CLI/IDE. Tiene lo esencial inline; el detalle completo está enlazado en **Documentación** (abajo).

## Stack

- **Lenguaje:** TypeScript (v5) estricto.
- **Runtime / gestor:** Bun (workspaces) — nunca `npm`.
- **Framework:** Next.js 16 (App Router) + React 19 (`apps/web`); worker Node/Bun con Puppeteer + FFmpeg.
- **Base de datos:** PostgreSQL/Supabase con Drizzle ORM (driver `pg`).
- **Almacenamiento:** S3 / MinIO (solo el video de la grabación; el texto va en DB).
- **IA:** Groq Whisper / Deepgram (transcripción) · Gemini / Groq / OpenAI (resumen). Solo en el worker.
- **Infra:** Docker + Docker Compose. **Versiones/APIs de librerías → Context7 (MCP), no de memoria.**

## Comandos

- `bun run dev` — modo dev recomendado: levanta infra + worker en Docker (`infra:up`) y arranca la **web nativa** con hot reload. La web corre nativa (rápida); el worker va en Docker porque su captura multimedia necesita Linux.
- `bun run dev:remote` — web nativa contra el worker **desplegado** (`-dev`): carga `.env.development.remote`. No levanta infra local (usa DB/MinIO/worker remotos).
- `bun run infra:up` / `infra:down` / `infra:reset` / `infra:logs` — controlan la infra en Docker (postgres + minio + worker). `infra:reset` borra los volúmenes de DB/MinIO y relevanta.
- `bun run dev:web` / `bun run dev:worker` — arrancan un solo rol nativo (cargan el env de raíz con `bun --env-file`).
- `bun run test` — ejecuta los tests (deben pasar antes de cada commit). Usa `--isolate`: `mock.module()` de Bun es global al proceso, así que sin aislar, un test que mockea un repositorio se lo impone a los demás archivos y las suites live-DB fallan según el orden de descubrimiento (se manifiesta en Linux/CI, no en Windows). No lances `bun test apps/__tests__` a secas.
- `bun run lint` — revisa el estilo (antes de cada PR).
- `bun run typecheck` — chequeo de tipos en todos los workspaces.
- `bun run build:web` — compila el web para producción (`NODE_ENV=production`).
- `bun run extension:build` — compila la extensión y regenera el ZIP interno.
- *Probar el web local contra el worker desplegado:* override `.env.development.remote` (apunta `WORKER_INTERNAL_BASE_URL` al worker `-dev`). Detalle en `spec/constitution/tech-stack.md`.

## Estructura del proyecto

- `apps/web/` — UI Next.js, APIs y server actions. Encola reuniones y muestra resultados. No procesa multimedia.
- `apps/worker/` — el motor: Puppeteer + FFmpeg + pipeline de IA. Reclama reuniones y avanza estados.
- `apps/extension/` — cliente Chrome (capa de presentación; nunca motor de grabación).
- `packages/shared/` — dominio, esquema DB, repositorios y contratos de integración compartidos.
- `spec/` — ciclo SDD: `constitution/` (las leyes) + `features/NNN-…/` (qué→cómo→tareas).
- `docs/` — documentación profunda (extensión, observabilidad) e histórico congelado.
- `.agents/skills/` — skills del proyecto (ver Documentación).
- `.github/workflows/` — CI (`ci.yml`: tests, lint, typecheck, build Docker) + `main-pr-source-guard.yml` (PR a `main` solo desde `dev` del mismo repo).
- Raíz: `docker-compose*.yml`, `Dockerfile.*`, `railway.json` (contrato de despliegue; Railway CD desde `main`).

## Convenciones

- **Cero acoplamiento a proveedores:** sin `if/switch` por proveedor en negocio/UI; variación → extender contrato (`interface`/`abstract class`/factory).
- **`package.json` raíz sin dependencias de runtime:** cada workspace declara las suyas propias; la raíz solo lleva `devDependencies` de tooling compartido. Evita drift de `bun.lock` (guardado por test en `apps/__tests__/repo/lockfile-consistency.test.ts`).
- **Código por rol:** web-only → `apps/web`; worker-only → `apps/worker`; compartido real → `packages/shared`. Nada no-compartido en `shared`.
- **API-first multicliente:** la lógica de negocio vive en backend; web y extensión la consumen vía API.
- **Sin regresiones:** no rompas funcionalidad ya operativa para arreglar un paso posterior; paso a paso.
- **Env docs sincronizados:** al cambiar una variable de entorno, actualizá `README.md` y los `.env.*.example` en el mismo bloque.
- **TDD obligatorio (lógica):** toda implementación o cambio de comportamiento empieza por el test que falla → código mínimo para pasarlo → refactor con la suite en verde. Aplica a dominio, servicios, repositorios, rutas/handlers, policies del chat y utilidades. Un cambio de lógica sin su test es incompleto. Excepción (validación por integración/manual): captura multimedia del worker (Puppeteer + FFmpeg) y UI puramente visual.
- **Tests en carpeta espejo:** todos viven en `apps/__tests__/`, replicando **app + área** del código: `apps/<app>/src/<área>/…` → `apps/__tests__/<app>/<área>/<nombre>.test.ts` (ej. `apps/web/src/modules/chat/http/trustBoundary.ts` → `apps/__tests__/web/modules/trustBoundary.test.ts`). Runner Bun, archivos `*.test.ts`. Nunca junto al código fuente.

## No hagas

- No uses `npm`/`yarn` (bun-only).
- No grabes con extensiones de Chrome ni `puppeteer-stream` — la captura es FFmpeg a nivel sistema.
- No pushees directo a `dev`/`main`: trabajá en ramas feature y mergeá por PR. `dev` corre CI pero **nunca** despliega; `main` es la única rama de deploy (Railway CD).
- No toques el contrato de despliegue (`Dockerfile.*`, `docker-compose*.yml`, `railway.json`, `.github/workflows/*.yml`) para lógica de app, ni sobreescribas env en compose (SSOT en `.env*`); avisá explícitamente si hay que tocarlos.
- No mezcles rol `web` y `worker` en la misma instancia de producción.
- No subas `.env*` reales al repo (solo los `.example`).
- No asumas versiones de librerías de memoria — consultá Context7.

## Flujo de trabajo

- **Rama nueva desde `dev`:** toda implementación (feature, fix, cambio de arquitectura) arranca creando una rama nueva a partir de `dev` actualizado (`git checkout dev && git pull && git checkout -b <rama>`). Nunca trabajar directo sobre `dev`/`main`.
- **Ciclo SDD:** toda feature nace en `spec/features/NNN-…/` como `spec.md` (qué) → `plan.md` (cómo) → `tasks.md` (checklist) **antes** de tocar código. Implementar **con TDD** (test rojo → verde → refactor) → verificar contra criterios → mover a "Hecho" en el roadmap.
- Antes de una tarea no trivial, **propón un plan y esperá mi OK**.
- **Una tarea a la vez**; al terminar, decime qué cambiaste para revisarlo.
- Si no estás seguro al 80%, **preguntá**. No inventes.
- Ante un riesgo técnico/seguridad o violación del diseño: **detente e informa**.

### Flujo CI/CD (verificado)

1. Rama feature desde `dev` (nunca directo sobre `dev`/`main`).
2. PR feature → `dev`.
3. CI corre `CI / validate` (tests, lint, typecheck, build de `Dockerfile.worker`).
4. Merge a `dev` tras CI verde + revisión.
5. PR `dev` → `main` — **gobernanza:** requiere aprobación de `devs-squaads`; `Guard main PR source` verifica que el origen sea `dev` del mismo repo.
6. CI corre de nuevo sobre `main`.
7. Merge a `main` tras CI verde + guard.
8. Railway auto-despliega desde `main` (Wait for CI gates; `GET /health` debe responder `200`).

**Reglas:** `dev` corre CI pero **nunca** despliega. `main` es la **única** rama de deploy. Railway es la única autoridad de CD y rollback. Rollback: desactivar autodeploy de Railway y restaurar el último deployment conocido como bueno. Detalle en `docs/deployment.md`.

## Documentación

- **Información del proyecto** (arquitectura, setup, env, endpoints) → `README.md`.
- **Despliegue del worker (CI/CD)** → `docs/deployment.md` (flujo feature→dev→main→Railway, rollback). CI en `dev`+`main`; CD solo desde `main` vía Railway.
- **Las LEYES completas** (stack, modelo de datos, las 14 reglas mandatorias, límites duros) → `spec/constitution/tech-stack.md`. Misión y alcance → `spec/constitution/mission.md`. Estado/roadmap → `spec/constitution/roadmap.md`.
- **Features en curso** → `spec/features/NNN-…/`. Guía del flujo → `spec/README.md`.
- **Docs profundas** → `docs/` (extensión, observabilidad). Histórico pre-SDD congelado → `docs/PROJECT_PROGRESS_LOG.md`.
- **Skills del proyecto** → `.agents/skills/` (fuente única). Índice y protocolo de carga en `.agents/skills/README.md`: cargá **solo** la skill cuyo trigger matchea la tarea, no las 14. Manifiesto reproducible en `skills-lock.json`.
- **Versiones/APIs de librerías** → Context7 (MCP `context7`), fuente de verdad de versiones recientes.
