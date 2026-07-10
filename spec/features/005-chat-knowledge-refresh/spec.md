# 005 · Refresh del corpus de conocimiento del chat helper

**Estado:** propuesta

## Qué hace

Actualiza las dos superficies de conocimiento del chat helper (`apps/web/src/integrations/chat/knowledge/`)
para cerrar el GAP con el estado real de la app, que quedó congelado en "Fase 8". El cambio es de contenido
(RAG-lite), no de capacidades: no agrega tools ni acciones de UI.

Dos entregables concretos:

1. **Corpus documental** (`documentCorpus.ts`): agrega 4 documentos y actualiza 1, con keywords en español
   pensadas para el retriever naive de token-overlap (`documentRetrieval.ts`, topK=4):
   - **Roles de equipo** (`authorized_accounts`, PR #28): qué es admin vs. member, quién puede gestionar el
     equipo, cómo se autorizan cuentas. Keywords: roles, rol, admin, administrador, member, miembro, permisos,
     equipo, compañero, autorizar, gestionar.
   - **Auth gate / redirección a login** (feature 003, `proxy.ts`): por qué la app redirige a login, que el
     acceso a páginas está protegido a nivel middleware. Keywords: login, redirigido, redirección, sesión,
     acceso, autenticación, protegido, iniciar sesión.
   - **Seguridad de la base de datos (RLS)** (feature 004, PR #32): profundidad **user-facing** para tranquilizar
     al usuario final ("tus datos están aislados y protegidos") + **una nota breve de operador** (RLS
     deny-by-default activo en las tablas del schema public). Keywords: seguridad, datos, protegido, privacidad,
     RLS, aislamiento, base de datos.
   - **Actualizar `settings-storage`**: alinear el copy con la Settings UX clarificada en PR #33 (botones de
     acción del equipo y copy de Service Account).

2. **Contexto en vivo** (`userContext.ts`): inyecta el **rol del usuario que consulta** (admin/member),
   disponible vía la sesión de NextAuth (`session.user.role`), dentro del contexto ensamblado. Así el chat
   responde preguntas dependientes de rol ("¿puedo cambiar roles?") sin necesidad de una tool nueva. Si el rol
   no está disponible, degrada de forma limpia sin romper el contexto.

## Por qué

El corpus del chat quedó desactualizado respecto a features ya en producción: team-role-management (PR #28),
page-auth-middleware (feature 003), RLS hardening (PR #32) y settings-ux-clarity (PR #33). HOY el chat da
respuestas erróneas o vacías cuando el usuario pregunta "¿por qué me redirigió a login?", "¿quién puede
gestionar el equipo?" o "¿mis datos están protegidos?". Es un cierre de gap de conocimiento, de bajo riesgo
(contenido aditivo + una línea de contexto), sin cambios de esquema, env, API, proveedor ni trust boundary.

Decisión de diseño de tools (confirmada): los hechos de **deploy-time** (postura de seguridad RLS, config fija)
van al corpus estático, no al tool surface. `get_system_status` queda intacto para lo que **sí cambia en
runtime** (worker vivo, cola trabada). Por eso no se extiende ninguna tool.

## Criterios de aceptación

_Condiciones verificables por test (TDD: rojo → verde → refactor). Tests en `apps/__tests__/web/integrations/`
según la convención de carpeta espejo._

- [ ] **Retrieval de roles**: la query `"¿cómo cambio el rol de un compañero?"` recupera el doc de roles de
      equipo entre los topK. Igual para `"¿quién puede gestionar el equipo?"` y `"soy admin o member?"`.
- [ ] **Retrieval de auth gate**: la query `"¿por qué me redirigió a login?"` recupera el doc de auth gate /
      redirección entre los topK.
- [ ] **Retrieval de seguridad**: la query `"¿mis datos están protegidos?"` (y `"¿qué es RLS?"`) recupera el
      doc de seguridad de base de datos entre los topK.
- [ ] **Retrieval de settings**: la query sobre configuración de equipo/Service Account recupera el doc
      `settings-storage` actualizado, con copy consistente con la Settings UX de PR #33.
- [ ] **Consistencia de acciones**: toda acción de UI mencionada en el corpus está contenida en la unión real
      de `ChatSuggestion.action` (`view_meetings | view_meeting_detail | install_extension | view_transcription
      | open_settings`). El chat no promete acciones que no puede ejecutar.
- [ ] **Inyección de rol (happy path)**: dado un usuario con `role = "admin"`, el contexto ensamblado por
      `buildUserContext` incluye el rol admin. Igual para `member`.
- [ ] **Inyección de rol (fallback)**: dado un usuario sin rol disponible, `buildUserContext` no lanza error y
      produce un contexto válido (degrada sin romper).
- [ ] **Sin regresiones**: la suite existente (`bun test apps/__tests__`) sigue en verde; ningún test de chat
      previo se rompe.
- [ ] **Env intacto**: el cambio NO toca variables de entorno; no se modifican `README.md` ni `.env.*.example`.

## Fuera de alcance

_Lo que esta feature NO incluye, para evitar que crezca._

- **Escalación de soporte a Discord**: es un cambio SDD independiente (ya diseñado en `docs/OBSERVABILITY_PLAN.md`,
  Track 1B), con un bloqueante de seguridad propio (`piiRedaction.ts` es no-op).
- **Extender `get_system_status`** ni ninguna otra tool: el tool surface queda intacto. RLS es hecho de
  deploy-time, va al corpus estático.
- **Tocar `catalog.ts` o las suggestion actions**: verificado que `open_settings` ya cubre la navegación
  necesaria; no se agregan acciones nuevas.
- Cambiar proveedor de IA, runtime del chat, policies o trust boundary.
- Reescribir el retriever (`documentRetrieval.ts`): se mantiene el token-overlap naive; solo se adaptan las
  keywords de los docs para que matcheen las queries reales.
