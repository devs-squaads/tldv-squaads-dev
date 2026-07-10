# 005 · Refresh del corpus de conocimiento del chat helper — Tareas

_Checklist accionable derivada de `plan.md`. Orden TDD (RED → GREEN), tests en
`apps/__tests__/web/integrations/` (carpeta espejo, nueva). AC = criterios de `spec.md`._

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250-320 (corpus +4 docs/1 update ~70, userContext.ts ~20, route.ts 1, 2 tests ~200) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | PR única |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Corpus (Fases 1-2) + rol en vivo (Fases 3-5) | PR 1 | Sin encadenar; ambos frentes son pequeños y comparten cierre/verificación. |

## Phase 1: Test rojo de retrieval (RED)

- [x] 1.1 Crear `apps/__tests__/web/integrations/knowledgeCorpusRefresh.test.ts`: importar
      `retrieveKnowledgeSnippets` real (`documentRetrieval.ts`) y `CHAT_DOCUMENT_CORPUS`
      (`documentCorpus.ts`). Test roles: `"¿cómo cambio el rol de un compañero?"`,
      `"¿quién puede gestionar el equipo?"`, `"soy admin o member?"` → doc `team-roles` en
      topK=4. (AC retrieval roles)
- [x] 1.2 Mismo archivo, test auth gate: `"¿por qué me redirigió a login?"` → doc
      `auth-gate-login` en topK. (AC retrieval auth gate)
- [x] 1.3 Mismo archivo, test seguridad: `"¿mis datos están protegidos?"` y `"¿qué es RLS?"` →
      doc `database-security` en topK. (AC retrieval seguridad)
- [x] 1.4 Mismo archivo, test settings: query de equipo/Service Account → doc `settings-storage`
      actualizado en topK. (AC retrieval settings)
- [x] 1.5 Mismo archivo, test de consistencia (anti-drift permanente): extraer del `content` de
      todo el corpus tokens `snake_case` (regex `/[a-z]+(?:_[a-z]+)+/g`), restar vocabulario de
      `meeting-lifecycle` (`waiting_admission`, `admission_timeout`, etc.), afirmar que el resto
      ⊆ unión `ChatSuggestion["action"]` (`ChatProvider.ts:29-34`). (AC consistencia)
- [x] 1.6 Confirmar ROJO: correr el archivo, 1.1-1.4 fallan (docs inexistentes).

## Phase 2: Corpus verde (GREEN de Fase 1)

- [x] 2.1 `documentCorpus.ts`: agregar doc `team-roles` (tags roles/admin/member/equipo/
      compañero/gestionar/cambiar) con las frases literales "quién puede gestionar el equipo" y
      "cambiar el rol de un compañero"; única acción UI citada: `open_settings`.
- [x] 2.2 `documentCorpus.ts`: agregar doc `auth-gate-login` (tags login/redirigido/redirigió/
      sesión/protegido) con la frase literal "redirigió a login".
- [x] 2.3 `documentCorpus.ts`: agregar doc `database-security` (tags seguridad/datos/protegido/
      privacidad/rls/aislamiento) con las frases literales "datos están protegidos" y "RLS";
      user-facing + una nota breve de operador (RLS deny-by-default en schema public, obs 951).
- [x] 2.4 `documentCorpus.ts`: actualizar doc `settings-storage` existente — copy alineado con la
      Settings UX de PR #33 (botones de acción del equipo + Service Account); sumar tags equipo/
      service/account/cuenta/servicio.
- [x] 2.5 Ajustar tags/content de 2.1-2.4 hasta que 1.1-1.5 pasen; palanca única: el doc, nunca
      `documentRetrieval.ts` (fuera de alcance).
- [x] 2.6 Verificar `knowledgeCorpusRefresh.test.ts` en VERDE.

## Phase 3: Test rojo de rol (RED)

- [x] 3.1 Crear `apps/__tests__/web/integrations/userContextRole.test.ts`: `mock.module` de
      `WebMeetingRepository`/`WebSettingsRepository` (patrón ya usado en la suite, ver
      `apps/__tests__/web/repositories/AuthorizedAccountRepository.test.ts`).
- [x] 3.2 Test: `buildUserContext({ role: "admin" })` → contexto incluye línea de rol admin.
- [x] 3.3 Test: `buildUserContext({ role: "member" })` → contexto incluye línea de rol member.
- [x] 3.4 Test: `buildUserContext()` sin argumento → no lanza, contexto válido, sin línea de rol.
- [x] 3.5 Test: repos mockeados para rechazar (fallback `catch`) + `role: "admin"` → el rol
      igual aparece en el contexto de fallback.
- [x] 3.6 Confirmar ROJO: `buildUserContext` no acepta parámetro todavía (falla de tipo/test).

## Phase 4: Rol verde (GREEN de Fase 3) + wiring

- [x] 4.1 `userContext.ts`: importar `AuthorizedAccountRole` desde
      `@meeting-bot/shared/repositories/AuthorizedAccountRepository` (mismo specifier que
      `apps/web/src/auth.ts:6-8`; el snippet de `plan.md` usa el bare `@meeting-bot/shared`, que
      no tiene export raíz — corregido al specifier real). Nueva firma:
      `buildUserContext(input: { role?: AuthorizedAccountRole } = {})`.
- [x] 4.2 `userContext.ts`: computar la línea de rol FUERA del `try` (antes de él); admin → "Rol
      del usuario: admin (puede gestionar el equipo y autorizar cuentas)"; member → "...(solo
      lectura de la gestión del equipo)"; sin rol → línea omitida.
- [x] 4.3 `userContext.ts`: renderizar la línea de rol en AMBAS ramas (éxito y `catch`) sin
      reestructurar el try/catch existente.
- [x] 4.4 `apps/web/src/app/api/chat/route.ts:78`: `buildUserContext()` →
      `buildUserContext({ role: session.user.role })`.
- [x] 4.5 Verificar `userContextRole.test.ts` en VERDE.

## Phase 5: Cierre

- [x] 5.1 Verificar env intacto: `git diff` no toca `.env.*` ni `README.md`. (AC env intacto)
- [x] 5.2 `bun test apps/__tests__` completo sin regresiones. (AC sin regresiones)
- [x] 5.3 `bun run typecheck` en verde.
- [x] 5.4 `bun run lint` en verde (sin errores nuevos en archivos tocados por esta feature).
- [x] 5.5 Smoke manual (no bloqueante): preguntar al chat local "¿quién puede gestionar el
      equipo?" y "¿mis datos están protegidos?", verificar que responde con el doc correcto.
- [x] 5.6 Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
