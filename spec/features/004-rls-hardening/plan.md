# 004 · Hardening de RLS en tablas del schema public — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

Todo el cambio de comportamiento vive en la base de datos; el código de la app no cambia. Se declara
`.enableRLS()` (drizzle-orm ^0.45.1, drizzle-kit ^0.31.9 — soportado desde orm 0.36/kit 0.28) en las
`pgTable` de `packages/shared/src/db/schema.ts` y se materializa con `drizzle-kit generate` en una única
migración versionada `0005`, que emite un `ALTER TABLE "<tabla>" ENABLE ROW LEVEL SECURITY;` por tabla.
Sin políticas (`CREATE POLICY`): fuera de alcance según `spec.md` — RLS activo sin políticas es
deny-by-default para los roles de PostgREST (`anon`, `authenticated`, sin `bypassrls`) y transparente
para la app, que conecta por `DATABASE_URL` con un rol con `rolbypassrls = true`.

La misma migración incluye `authorized_accounts` (RLS ya activo a mano en dev-remote, sin migración que
lo respalde): `ENABLE ROW LEVEL SECURITY` es idempotente en Postgres — re-ejecutarlo sobre una tabla que
ya lo tiene activo no falla — así que un solo archivo cubre el drift y los ambientes desde cero.

La verificación sigue el precedente del repo en dos capas: un test **estático** de la migración (como
`apps/__tests__/repo/authorized-accounts-migration.test.ts`, siempre corre, sin infra) y un test de
**integración contra Postgres real** — primero de su tipo en el repo, porque RLS es comportamiento del
servidor Postgres y mockearlo no prueba nada — que se auto-skipea si no hay DB alcanzable, para que
`bun test apps/__tests__` siga pasando pre-commit sin `infra:up`.

## Implementación

Los exports exactos de `schema.ts` a tocar (verificados en el archivo): `users`, `authorizedAccounts`,
`meetings`, `settings`, `meetingShares`, `meetingShareAccessLogs`, `chatMessages` — 7 en total
(6 nuevas + el drift de `authorized_accounts`).

1. **Test estático rojo** — `apps/__tests__/repo/rls-hardening-migration.test.ts` (carpeta espejo,
   mismo patrón `readFileSync` + regex que el test de 0004): afirma que existe
   `drizzle/0005_enable_rls.sql` y que contiene exactamente un
   `ALTER TABLE "<nombre>" ENABLE ROW LEVEL SECURITY` por cada una de las 7 tablas
   (`users`, `authorized_accounts`, `meetings`, `settings`, `meeting_shares`,
   `meeting_share_access_logs`, `chat_messages`) y ningún otro statement destructivo
   (sin `DROP`, sin `CREATE POLICY`). Rojo: el archivo no existe.
2. **Schema** — en `packages/shared/src/db/schema.ts`, encadenar `.enableRLS()` al final de cada una de
   las 7 `pgTable` (en `chatMessages`, después del tercer argumento de índices). Cero cambios de
   columnas, tipos ni imports nuevos.
3. **Generar la migración** — `bunx drizzle-kit generate --name enable_rls` (config existente en
   `drizzle.config.ts`: schema `./packages/shared/src/db/schema.ts`, out `./drizzle`). Produce
   `drizzle/0005_enable_rls.sql` + snapshot + entrada en `drizzle/meta/_journal.json`. **Revisar el SQL
   generado a mano**: debe contener solo los 7 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` — si
   drizzle-kit emite cualquier otro diff, hay drift previo entre snapshot 0004 y el schema, y se
   resuelve antes de seguir (no se commitea una migración con ruido). Test del paso 1 en verde.
4. **Test de integración rojo** — `apps/__tests__/repo/rls-live-regression.test.ts`:
   - Conexión: `Pool` de `pg` con `process.env.DATABASE_URL` (fallback al mismo default local de
     `drizzle.config.ts`) y `drizzle(pool, { schema })` importando el schema real de
     `packages/shared/src/db/schema.ts`.
   - Gate de infra: intento de conexión con timeout corto (~1s) en top-level await; si falla,
     `describe.skipIf(true)` con mensaje "requiere `bun run infra:up`". Así el suite pasa en cualquier
     máquina sin Docker levantado.
   - Por cada una de las 6 tablas del spec (y `authorized_accounts`), dos aserciones:
     a. **RLS está activo**: `SELECT relrowsecurity FROM pg_class WHERE relname = '<tabla>'` es `true`.
        Este es el rojo real del ciclo TDD: falla hasta aplicar la migración en la DB local (paso 5).
     b. **Drizzle sigue leyendo/escribiendo**: `insert` de una fila mínima (ids `crypto.randomUUID()`,
        solo columnas NOT NULL; el schema no declara `.references()`, así que no hacen falta filas
        padre), `select` que la encuentra, `delete` de limpieza. Todo dentro del mismo test para no
        dejar basura; ids aleatorios para no chocar con datos existentes de dev local.
5. **Aplicar en local** — ejecutar el SQL versionado contra la DB de Docker (valida el artefacto real,
   no solo el estado): `Get-Content drizzle/0005_enable_rls.sql | docker compose exec -T postgres psql
   -U postgres -d meeting_bot` (o `bun run db:push`, que llega al mismo estado diffeando el schema, pero
   no ejercita el archivo de migración — preferir el SQL). Test del paso 4 en verde.
6. **Aplicar en dev-remote** — ejecutar `drizzle/0005_enable_rls.sql` tal cual en Supabase (SQL editor o
   `apply_migration` del MCP). La línea de `authorized_accounts` no falla aunque ya esté activo
   (idempotencia). Verificar que el advisor de seguridad deja de reportar las 6 tablas en ERROR
   (`get_advisors`; puede tardar un refresco). Producción: mismo archivo, mismo procedimiento, cuando
   toque el deploy.
7. **Cierre** — `bun test apps/__tests__`, `bun run typecheck`, `bun run lint`. Smoke manual mínimo en
   dev local: la web lista meetings y el chat escribe `chat_messages` igual que antes.

## Decisiones

- **`.enableRLS()` declarativo + `drizzle-kit generate`, no SQL a mano** — el estado de RLS queda en el
  schema (fuente única) y trackeado por el snapshot de drizzle; una migración manual suelta repetiría
  exactamente el drift de `authorized_accounts` que esta feature viene a corregir.
- **Una sola migración 0005 para las 7 tablas, incluida `authorized_accounts`** — la idempotencia de
  `ENABLE ROW LEVEL SECURITY` hace innecesario cualquier guard condicional o migración separada para el
  drift: el mismo archivo es correcto en dev-remote (ya activo) y en un ambiente desde cero (lo activa).
- **Test de integración contra Postgres real, auto-skippeable** — no hay precedente de test con DB viva
  en `apps/__tests__/` (todo es unit con mocks o aserción estática de archivos), pero RLS es un
  comportamiento del servidor que un mock no puede demostrar. El skip por conexión mantiene el contrato
  "los tests pasan antes de cada commit" sin exigir `infra:up`; en una máquina con la infra levantada
  (el flujo `bun run dev` normal) corre completo.
- **Limitación asumida del test local**: el rol `postgres` del Docker local es superusuario (bypassa RLS
  implícitamente), igual que el rol de `DATABASE_URL` en dev-remote tiene `rolbypassrls = true`. El test
  demuestra la garantía que pide el spec — la conexión de la app sigue operando con RLS activo — pero
  **no puede simular la pérdida de `bypassrls`**; si eso pasara en un ambiente real, este mismo test
  corrido contra esa DB fallaría en las aserciones CRUD, que es exactamente la red de regresión buscada.
- **Sin `CREATE POLICY`** — reafirmado del spec: ningún cliente consume estas tablas vía
  PostgREST/`anon key` hoy; políticas sin consumidor son diseño especulativo. Upgrade path documentado
  en `spec.md` (si algún día entra `@supabase/supabase-js` del lado cliente, ahí se diseñan políticas).
- **Tests en `apps/__tests__/repo/`** — el schema vive en `packages/shared`, que no tiene espejo propio
  en `apps/__tests__/`; el precedente exacto para artefactos de migración es
  `apps/__tests__/repo/authorized-accounts-migration.test.ts`, se sigue ese.

## Rollback

Trivial y sin pérdida de datos — RLS activo/inactivo no toca filas ni estructura:

1. Ejecutar `ALTER TABLE "<tabla>" DISABLE ROW LEVEL SECURITY;` por cada tabla afectada en el ambiente
   con problemas (revierte al estado actual de hoy en segundos, sin downtime).
2. Revertir el commit (schema + migración + tests) si el rollback es definitivo, para que el snapshot de
   drizzle vuelva a coincidir con la realidad.
3. `authorized_accounts` es la excepción: NO deshabilitarle RLS en dev-remote (ya operaba así antes de
   esta feature; apagarlo sería introducir una regresión de seguridad ajena al rollback).

## Riesgos

- **Drift acumulado entre snapshot 0004 y el schema actual** — si algo se aplicó a mano en alguna DB sin
  pasar por `generate`, el 0005 podría traer statements extra. Mitigación: revisión manual obligatoria
  del SQL generado (paso 3); si aparece ruido, se investiga y resuelve como trabajo previo, no se
  commitea mezclado.
- **`db:push` local puentea la migración versionada** — `push` diffea schema↔DB directo, sin journal;
  una DB local puede terminar con RLS activo sin haber ejecutado 0005. Aceptado: el artefacto versionado
  existe para dev-remote/producción y para ambientes desde cero; el test estático garantiza que el
  archivo es correcto independientemente de cómo se aplicó en local.
- **El advisor de Supabase tarda en refrescar** — el criterio "deja de reportar ERROR" puede no ser
  inmediato tras aplicar en dev-remote. Mitigación: verificar también `pg_class.relrowsecurity` directo
  (verdad del servidor) y re-consultar el advisor más tarde.
- **Orden de despliegue web (Vercel) vs migración** — nulo en este caso: el cambio de schema TypeScript
  no altera tipos ni queries, y la app opera igual con RLS on u off (bypassrls). No hay ventana de
  incompatibilidad entre código viejo/nuevo y DB migrada/sin migrar.
- **Falso verde del test de integración por skip silencioso** — si la infra local nunca está levantada,
  el test live no corre y nadie lo nota. Mitigación: el skip loguea un mensaje explícito, y el criterio
  de aceptación del spec exige correrlo en verde (con infra) antes de dar la feature por terminada.
