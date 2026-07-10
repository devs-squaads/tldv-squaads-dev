# 004 · Hardening de RLS en tablas del schema public — Tareas

_Checklist accionable derivada del `plan.md`. Orden TDD (RED → GREEN): primero el test que falla,
luego el código/migración mínima que lo pasa. AC1-AC6 = criterios de `spec.md`, en orden._

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120-180 (schema +7, migración ~15, 2 tests ~150) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | PR única |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

**Riesgo que puede subir el forecast**: `_journal.json` solo tiene el índice `0`, sin entradas ni
snapshots para `0001`-`0004` (drift confirmado, no hipotético). Si `drizzle-kit generate` diffea
contra `0000`, puede emitir más que los 7 `ALTER TABLE` esperados → subiría a Medium/High. Gate en
tarea 2.3; resolución como trabajo previo, sin mezclar en este PR (ya en `plan.md` → Riesgos).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema + migración `0005` + 2 tests | PR 1 | Sin encadenar; único paralelismo posible es escribir el test de Fase 3 junto con la Fase 2. |

## Phase 1: Test estático de la migración (RED)

- [x] 1.1 `apps/__tests__/repo/rls-hardening-migration.test.ts`: afirma que
      `drizzle/0005_enable_rls.sql` existe con exactamente un `ALTER TABLE "<tabla>" ENABLE ROW
      LEVEL SECURITY` por cada una de las 7 tablas (`users`, `authorized_accounts`, `meetings`,
      `settings`, `meeting_shares`, `meeting_share_access_logs`, `chat_messages`), sin `DROP` ni
      `CREATE POLICY` (RED: el archivo no existe). (AC2) — confirmado RED (9 fail, ENOENT) antes
      de escribir la migración.

## Phase 2: Schema + migración (GREEN de 1.1)

- [x] 2.1 `packages/shared/src/db/schema.ts`: encadenar `.enableRLS()` al final de las 7 `pgTable`
      (en `chatMessages`, después de los índices). Cero cambios de columnas/tipos/imports. (AC2)
- [x] 2.2 **AJUSTE confirmado por el usuario** (reemplaza el paso original): NO se corrió
      `drizzle-kit generate` — `drizzle/meta/_journal.json` solo registra la migración `0000`
      (0001-0004 fueron escritas a mano, sin snapshots propios; `generate` hubiera diffeado
      contra el snapshot `0000` desactualizado). En su lugar se escribió
      `drizzle/0005_enable_rls.sql` a mano, mismo estilo (`--> statement-breakpoint`) que
      0001-0004. No se tocó `_journal.json` (problema previo, fuera de esta feature). (AC2, AC3)
- [x] 2.3 **Gate obligatorio**: revisado a mano — el archivo contiene exactamente los 7
      `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`, sin otro statement. No aplica drift porque no
      se generó por diff.
- [x] 2.4 Test 1.1 verificado en GREEN (9 pass).

## Phase 3: Test de integración contra Postgres real (RED)

- [x] 3.1 `apps/__tests__/repo/rls-live-regression.test.ts`: conexión real vía
      `packages/shared/src/db/liveConnection.ts` (nuevo, `createLiveConnection` +
      `drizzle(pool)` + `sql` re-exportado desde `drizzle-orm/node-postgres`/`drizzle-orm/sql`),
      no vía `@meeting-bot/shared/db` ni `@meeting-bot/shared/db/schema` ni `drizzle-orm` bare —
      esos tres specifiers están mockeados globalmente por `mock.module()` en los tests de
      repositorios (`apps/__tests__/helpers/dbSchemaMock.ts`), y Bun comparte el registro de
      mocks para todo el proceso de `bun test`; importarlos de verdad rompía o era roto por esos
      mocks (verificado empíricamente). Timeout ~1s en top-level await
      (`db.execute(sql\`SELECT 1\`)`), `describe.skipIf(!dbAvailable)`.
- [x] 3.2 Por cada una de las 7 tablas, assert `SELECT relrowsecurity FROM pg_class WHERE relname
      = '<tabla>'` es `true`. Confirmado RED real (7 fail, `Received: false`) antes de aplicar la
      migración — infra local ya estaba arriba en esta sesión. (AC1, AC3)
- [x] 3.3 Por cada una de las 7 tablas, en el mismo test: `insert` mínimo (ids
      `crypto.randomUUID()`, solo NOT NULL) vía `db.execute(sql\`INSERT ...\`)`, `select` que lo
      encuentra, `delete` de limpieza. (AC5)

## Phase 4: Aplicar migración en local (GREEN de la Fase 3)

- [x] 4.1 Infra ya estaba arriba (contenedores `meeting-db`/`meeting-worker`/`meeting-storage`
      corriendo). Aplicado con `docker compose exec -T postgres psql -U postgres -d meeting_bot <
      drizzle/0005_enable_rls.sql` (no `db:push`): 7× `ALTER TABLE` confirmado en la salida.
- [x] 4.2 Tests 3.2 y 3.3 verificados en GREEN (7 pass, 14 expect() calls).

## Phase 5: Aplicar en dev-remote y producción

**Fuera del alcance de este batch — responsabilidad explícita del usuario.** El ejecutor no
cuenta con MCP de escritura sobre Supabase dev-remote/producción.

- [x] 5.1 Ejecutado por el usuario en Supabase dev-remote vía SQL Editor, guardado como query
      **"Shared"** con el nombre `0005_enable_rls` (mismo criterio que las queries ya guardadas
      `CREATE TABLE authorized_accounts` = migración 0004, `UPDATE authorized_accounts` = fix de
      datos del admin) — trazabilidad 1:1 entre archivo versionado y query guardada en el
      dashboard. Idempotente para `authorized_accounts`, confirmado sin error. (AC3)
- [x] 5.2 Verificado con `get_advisors(type: security)` tras la ejecución: las 6 tablas pasaron de
      `ERROR` (`rls_disabled_in_public`) a `INFO` (`rls_enabled_no_policy`), igual que
      `authorized_accounts`. (AC1, AC4)
- [ ] 5.3 Aplicar el mismo archivo en producción en el próximo deploy real (push a `dev`/`main`).
      **Nota importante**: las queries "Shared" guardadas en el SQL Editor de dev-remote son del
      dashboard de *ese* proyecto Supabase — no confirmado que producción sea el mismo proyecto
      (branching) o uno separado (`list_branches` del MCP devolvió error "Project reference is
      missing", sin evidencia de branches configurados). Asumir que **no** se comparten y que hay
      que volver a pegar/guardar la query `0005_enable_rls` en el SQL Editor del proyecto de
      producción llegado el momento, salvo que se confirme lo contrario.

## Phase 6: Cierre

- [x] 6.1 (parcial) `bun test apps/__tests__` → 149 pass / 0 fail. `bun run typecheck` → limpio
      (exit 0). `bun run lint` → 26 errores preexistentes, **ninguno en archivos tocados por esta
      feature** (todos en `smooth-cursor.tsx`, `venom-beam.tsx`, `gemini.ts`, `openai.ts`,
      `S3StorageProvider.ts` — deuda previa no relacionada, confirmado con `git status`). No se
      tocaron esos archivos ni se intentó arreglarlos (fuera de alcance).
- [ ] 6.2 Smoke manual en dev local: la web lista meetings y el chat escribe `chat_messages` igual
      que antes. (AC6) — no ejecutado en este batch (verificación manual de UI); el regression
      test 3.3 ya cubre insert/select/delete real de `users`/`meetings`/`chat_messages` vía
      Drizzle bajo RLS, lo que reduce el riesgo pero no reemplaza el smoke visual.
- [ ] 6.3 Validar los 6 criterios de aceptación de `spec.md` uno por uno — AC2, AC3, AC5 verificados
      localmente; AC1 y AC4 verificados en local y dev-remote (falta producción, 5.3); AC6
      verificado por tests automatizados, falta smoke manual (6.2).
- [ ] 6.4 Mover la feature a "Hecho" en `../../constitution/roadmap.md` — pendiente hasta cerrar
      la Fase 5 (dev-remote/producción) y el smoke manual.
