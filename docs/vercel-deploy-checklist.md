# Checklist de despliegue en Vercel (web)

> Checklist para quien tenga acceso al dashboard de Vercel del proyecto. Objetivo: que el push a la rama
> de producción dispare un deploy automático que termine en estado `Ready` con las variables correctas.

## Paso 0 — Descartar primero la causa más probable: plan Hobby + colaborador

**Esta es la causa más probable del patrón "se rompió en varios PRs seguidos"**, confirmada por la
documentación oficial de Vercel (ver fuentes al final): en el **plan Hobby (gratuito)**, si el **autor
del commit** que llega a la rama de producción **no es el dueño de la cuenta de Vercel**, el deploy queda
**bloqueado automáticamente** — Vercel ni siquiera intenta buildearlo. El error que muestra es
*"Git author must have access to the project on Vercel to create deployments"*. Pasa tanto en push
directo como en merge de PR, si el commit final conserva la autoría del colaborador.

Cómo confirmarlo: en **Deployments**, buscar el deployment del commit que no se publicó — si dice
"Blocked" o el error de arriba en vez de "Building"/"Error" de build, es esto.

Dos salidas reales (no hay una tercera "arreglalo en el código"):
1. **Upgrade a plan Pro** + agregar a los colaboradores como *team members* del proyecto → los commits de
   cualquiera vuelven a auto-deployar igual que los del dueño.
2. **Quedarse en Hobby** → el dueño de la cuenta queda como único punto de deploy: tiene que entrar al
   dashboard y hacer **Redeploy manual** cada vez que un commit de un colaborador llegue a la rama de
   producción (o ser quien hace el merge final, si eso preserva su autoría en el commit).

Fuentes:
- [Troubleshoot project collaboration — Vercel Docs](https://vercel.com/docs/deployments/troubleshoot-project-collaboration)
- [Vercel — "Git author must have access..." fix](https://blog.saif71.com/fix-vercel-git-error/)

## Antes de empezar

El repo (`tldv-squaads`) **no tiene `vercel.json`** — toda la configuración de build y las variables de
entorno viven únicamente en el dashboard de Vercel. Por eso este chequeo tiene que hacerse ahí, a mano.
No hay forma de verlo ni corregirlo desde el código.

> **Instrucción para cuando se haga el deploy con apoyo de IA:** crear un archivo `vercel.json` en la
> **raíz del repo** (contenido exacto en el Paso 4). Así el Build Command / Install Command / Output
> Directory quedan versionados en git en vez de vivir solo en el dashboard — que es justo lo que hoy
> hace imposible saber, desde el código, qué tiene configurado Vercel.

## Paso 1 — Confirmar que la integración con GitHub sigue conectada

En Vercel → proyecto del `web` → **Settings → Git**:
- Confirmar que el repo conectado es `product-squaads/tldv-squaads`.
- Confirmar que el estado de la conexión no diga "disconnected" / no pida reautenticar.
- Desde GitHub: **Settings → Applications → Installed GitHub Apps → Vercel** → confirmar que el
  permiso sigue activo sobre este repo (no revocado, no limitado a otro repo).

## Paso 2 — Confirmar qué branch dispara Production

En **Settings → Git → Production Branch**:
- Anotar qué branch está seteado ahí (`main` o `dev`).
- Confirmar que coincide con la branch a la que el equipo efectivamente pushea para ir a producción
  (según el flujo del repo, el worker usa `dev` = development y `main` = production; el web debería
  seguir el mismo criterio).
- Revisar si hay un **"Ignored Build Step"** con un script custom configurado. Si existe, verificar que
  no esté salteando el build en cada push por error (un script mal escrito ahí puede hacer que Vercel
  decida "no hay nada que buildear" siempre).

## Paso 3 — Revisar el historial de Deployments

En **Deployments**:
- Ver si aparece un deployment por cada push reciente a la branch de producción.
  - Si **no aparece nada** → el problema es de integración/webhook (volver al Paso 1).
  - Si aparece pero queda en **Error** → abrir ese deployment y copiar el Build Log completo.
- Si hay un deployment fallido, revisar el log buscando específicamente:
  - Errores de instalación (`bun install` fallando).
  - `Module not found: @meeting-bot/shared` → indicaría que el **Root Directory** está mal seteado
    (debería ser la raíz del repo, no `apps/web`, porque el proyecto usa workspaces de Bun).

## Paso 4 — Crear `vercel.json` en la raíz (en vez de dejarlo solo en el dashboard)

Pedirle a quien haga el deploy (o a la IA que lo asista) que cree este archivo en la **raíz del repo**:

```json
{
  "buildCommand": "bun run build",
  "installCommand": "bun install",
  "outputDirectory": "apps/web/.next",
  "framework": "nextjs"
}
```

Por qué este contenido puntual:
- `buildCommand`/`installCommand` reflejan la cadena real que ya usa el repo
  (`bun run build` → `build:web` → `next build --webpack` dentro de `apps/web`), así no depende de que
  alguien lo haya tipeado bien a mano en el dashboard.
- `outputDirectory` apunta a `apps/web/.next` porque el **Root Directory del proyecto en Vercel debe
  quedar en la raíz del repo** (vacío / `.`), no en `apps/web` — el proyecto usa workspaces de Bun y
  `packages/shared` tiene que resolverse desde ahí. Si el Root Directory está mal seteado en `apps/web`,
  ese es justamente el error `Module not found: @meeting-bot/shared` del Paso 3.
- `framework: "nextjs"` para que Vercel siga aplicando sus optimizaciones propias de Next (edge/serverless
  functions, static assets) aunque el build command sea custom.

Una vez creado y mergeado, todavía hay que confirmar en el dashboard (**Settings → General →
Build & Development Settings**) que no haya un valor manual cargado ahí que pise lo que dice
`vercel.json` (los overrides del dashboard tienen prioridad sobre el archivo) — y revisar
**Node.js Version** ahí mismo, porque el repo no tiene versión de Bun pineada (`packageManager` en
`package.json`), así que conviene confirmar a mano que la versión que usa Vercel es compatible con
Bun/Next 16.

## Paso 5 — Confirmar variables de entorno de **Production**

En **Settings → Environment Variables**, confirmar que existen y están asignadas específicamente al
ambiente **Production** (Vercel separa Production / Preview / Development — una variable cargada solo en
Development no aplica a Production):

- `DATABASE_URL`
- `API_ROUTE_SECRET`
- `WORKER_INTERNAL_BASE_URL` → debe apuntar a `https://worker-tldv.server.squaads.com`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_APP_URL` (si no está, algunos links compartidos van a caer a un fallback vacío)
- `SUPER_ADMIN_EMAILS` — **nueva**, todavía no está en producción: la introduce la feature
  `auth-scope-allowlist` (rama `feat/auth-scope-allowlist`, en integración). Hay que cargarla en Vercel
  recién cuando esa rama se mergee y despliegue — si se agrega antes, no rompe nada (no se lee todavía),
  pero si se olvida después del merge, el allowlist de admins queda vacío en producción.

Importante: **un cambio de variable en el dashboard no aplica solo — hace falta un Redeploy** para que
tome efecto.

## Paso 6 — Forzar un deploy y verificar

- Botón **Redeploy** sobre el último commit de la branch de producción (o hacer un push trivial).
- Confirmar en Deployments que termina en **Ready**.
- Abrir el sitio productivo y confirmar que el commit que muestra Vercel coincide con el último commit
  de `git log -1` en la branch de producción.

---

# Diagnóstico técnico (contexto interno)

## Contexto

Se reportó que, desde hace varios PRs, el auto-deploy en Vercel dejó de funcionar. Hipótesis inicial:
falta alguna variable de entorno o alguna configuración de Vercel está rota/incompleta.

Se investigó el repo completo (git log, configuración de build, `.vercelignore`, `next.config.ts`,
README, memoria de sesiones previas) para intuir cómo está armado el despliegue y encontrar qué, desde
el lado del repo, podría explicar la rotura. Conclusión adelantada: **el repo hoy está sano** — la causa
más probable de que el auto-deploy siga sin funcionar vive en el dashboard de Vercel, invisible desde
git. Este documento combina la guía accionable de arriba con el diagnóstico técnico que la respalda.

## Qué confirma el repo sobre cómo está desplegado

- **No existe `vercel.json`** en ningún lado del repo. Todo Root Directory / Install Command / Build
  Command / Output Directory / variables de entorno vive **solo en el dashboard de Vercel** — nada de
  eso está versionado ni es diffable desde git.
- **Ningún workflow de `.github/workflows/` despliega el web.** Los dos workflows existentes
  (`deploy-development.yml`, `deploy-production.yml`) solo hacen SSH al servidor Squaads y corren
  `deploy.sh` para el **worker**. El web depende 100% de la integración Git nativa de Vercel
  (GitHub App/webhook), fuera del control de este repo.
- `README.md:263-266` documenta que el `web` en Vercel necesita `DATABASE_URL`, `API_ROUTE_SECRET`,
  `WORKER_INTERNAL_BASE_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — pero no
  documenta qué branch está mapeado a Production en Vercel ni el Root Directory/Build Command exacto.
- `.vercelignore` (raíz) excluye `apps/worker`, `apps/extension` y todo `*.md`, lo que implica que el
  build de Vercel corre con **Root Directory = raíz del repo** (no `apps/web` aislado).
- Build chain real: `bun run build` (raíz) → `build:web` → `bun run --cwd apps/web build` →
  `env NODE_ENV=production next build --webpack`. No hay `vercel-build` script ni `packageManager`/
  `engines` fijado (Vercel autodetecta Bun por la presencia de `bun.lock`, sin versión pineada).
- `apps/web/next.config.ts` tiene `output: "standalone"` — pensado para el Dockerfile del worker/web
  self-hosted, no necesario en Vercel (Vercel hace su propio file tracing), pero no debería romper el build.

## Dos regresiones reales ya encontradas en el historial (y ya arregladas)

1. **`bun.lock` desincronizado del root `package.json` durante ~2 meses** (commit `4342f73`, 24 abr →
   fix en PR #26 `829fd2c`, 3 jul). Si Vercel corre `bun install --frozen-lockfile` (su default cuando
   detecta lockfile), esto **rompería el install step** durante toda esa ventana. Hoy, en el tip de
   `dev`, `package.json` y `bun.lock` están en sync (verificado leyendo ambos directamente).
2. **`.vercelignore` excluyó `apps/web/src` por completo** durante ~47 minutos el 24 de abril
   (patrón `src` sin ancla, matcheaba cualquier carpeta `src` a cualquier profundidad, incluyendo
   `apps/web/src`). Se corrigió el mismo día anclando a `/src`. Hoy está bien.

Ambas están resueltas en el HEAD actual de `dev`. Si el auto-deploy sigue roto **ahora**, ninguna de las
dos lo explica — hay que mirar el dashboard.

## Señal de proceso a tener en cuenta

Varios commits directos a `dev` (sin PR) de una identidad genérica `product-squaads <product@squaads.com>`
tocaron justo los archivos sensibles para Vercel: versión de `package.json` (`4342f73`, `1fd1f40`,
`d2a0f8b`) y `.vercelignore` (`b9c87e7`, `5c7416e`, `e41bb4a`). Es el mismo patrón que causó las dos
regresiones de arriba. Si alguien tiene acceso de admin al dashboard de Vercel y lo usó para cambiar algo
(branch de producción, Ignored Build Step, env vars) sin dejar rastro en el repo, no hay forma de verlo
desde git — solo desde el dashboard mismo o su historial de actividad ("Audit Log", plan Vercel Pro+).

## Verificación

Una vez identificado y corregido el punto roto en el dashboard: hacer un push trivial (o "Redeploy") a la
branch de producción y confirmar en **Deployments** que (a) el build se dispara automáticamente,
(b) termina en estado `Ready`, y (c) el sitio productivo sirve el commit nuevo (verificar hash de commit
visible en el deployment vs. `git log -1`).
