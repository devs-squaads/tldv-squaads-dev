# 005 · Refresh del corpus de conocimiento del chat helper — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

Cambio de contenido (RAG-lite) más una inyección de contexto, todo dentro de
`apps/web/src/integrations/chat/knowledge/`. Dos frentes:

1. **Corpus** (`documentCorpus.ts`): +4 `KnowledgeDocument` y 1 actualizado. El shape existente es
   `{ id, title, tags: string[], content }` (documentCorpus.ts:1-6); no se toca la interfaz ni el
   retriever. Las keywords se eligen contra el algoritmo real de `documentRetrieval.ts`: score =
   cobertura de tokens de la query (tras normalizar acentos y filtrar stopwords como `qué`, `es`,
   `me`, `por`, `como`) + boost por frase exacta (+0.35) + boost por hit en título (+0.2), topK=4.
   Consecuencia práctica: los docs deben contener **las formas literales que tokeniza la query**
   (`redirigió` → `redirigio`, `compañero` → `companero`), no sinónimos.

2. **Contexto en vivo** (`userContext.ts`): `buildUserContext()` hoy no recibe argumentos
   (userContext.ts:10) y arma el bloque con counts + settings dentro de un `try/catch` con fallback.
   Se le agrega un parámetro opcional con el rol del caller, que el único call site
   (`app/api/chat/route.ts:78`) ya tiene a mano: la sesión se resuelve en route.ts:29 y
   `session.user.role` existe tipado como `"admin" | "member" | undefined` (types/next-auth.d.ts:7,
   seteado en el session callback de `auth.ts`).

## Decisión central: cómo fluye el rol hasta `buildUserContext`

| Opción | Tradeoff |
|---|---|
| **(A) Parámetro**: `buildUserContext({ role? })` desde el route | El route ya tiene la sesión (route.ts:29→78, cero fetch extra). La función de conocimiento queda pura respecto a la request: testear `role="admin"`, `"member"` y `undefined` es pasar un argumento. Único costo: tocar 1 línea del call site. |
| (B) Leer `getServerSession(authOptions)` adentro de `buildUserContext` | Duplica la resolución de sesión por request, acopla la capa de conocimiento a NextAuth/detalles de request (contra el criterio API-first del proyecto) y obliga a mockear `next-auth` en cada test de los criterios de aceptación. |

**Elegida: (A).** Firma nueva:

```ts
import type { AuthorizedAccountRole } from "@meeting-bot/shared"; // "admin" | "member" (AuthorizedAccountRepository.ts:5)

export async function buildUserContext(
  input: { role?: AuthorizedAccountRole } = {},
): Promise<string>
```

Puntos clave de la implementación:

- La línea de rol se computa **antes** del `try` (no depende de datos awaiteados) y se renderiza en
  **ambas ramas** — éxito y fallback del `catch` — así el rol sobrevive aunque fallen los
  repositorios. El `try/catch` existente no cambia de forma.
- Sin rol (`undefined`): se omite la línea de rol; el contexto sigue siendo válido (criterio de
  fallback de la spec). No se inventa un "rol desconocido".
- Render sugerido dentro del bloque `CONTEXTO DEL SISTEMA`:
  `Rol del usuario: admin (puede gestionar el equipo y autorizar cuentas)` /
  `Rol del usuario: member (solo lectura de la gestión del equipo)`.
- El default `= {}` mantiene retro-compatibilidad: cualquier llamada existente sin argumentos sigue
  compilando (no hay más call sites que route.ts, verificado por grep).
- `promptAssembler.ts` no cambia: recibe `userContext` como string ya armado (promptAssembler.ts:47)
  y lo concatena como última sección del system prompt.

## Diseño de los docs nuevos (contenido + keywords para el retriever)

Cada doc incluye en `content` la frase literal de al menos una query de aceptación (activa el
`exactPhraseBoost`) y en `tags` los tokens que sobreviven a la tokenización de las queries reales.

1. **`team-roles`** — título: "Roles de equipo: admin y member".
   Tags: `roles`, `rol`, `admin`, `administrador`, `member`, `miembro`, `permisos`, `equipo`,
   `compañero`, `autorizar`, `gestionar`, `cambiar`, `cambio`.
   Content (user-facing): quién puede gestionar el equipo (solo admin), qué puede hacer un member,
   cómo se autoriza una cuenta nueva y cómo cambiar el rol de un compañero desde Settings
   (acción de UI: `open_settings`). Debe contener literalmente "quién puede gestionar el equipo" y
   "cambiar el rol de un compañero".
2. **`auth-gate-login`** — título: "Acceso protegido y redirección a login".
   Tags: `login`, `redirigido`, `redirigió`, `redirección`, `sesión`, `acceso`, `autenticación`,
   `protegido`, `iniciar`.
   Content: todas las páginas requieren sesión iniciada; si la sesión expira o no existe, el
   middleware redirige a login automáticamente; basta volver a iniciar sesión. Debe contener
   literalmente "redirigió a login".
3. **`database-security`** — título: "Seguridad de tus datos (RLS)".
   Tags: `seguridad`, `datos`, `protegido`, `protegidos`, `privacidad`, `rls`, `aislamiento`, `base`.
   Content (decisión del usuario, obs 951): user-facing primero — "tus datos están aislados y
   protegidos" a nivel base de datos — más UNA nota breve de operador: RLS deny-by-default activo
   en todas las tablas del schema public. Debe contener literalmente "datos están protegidos" y
   "RLS".
4. **`settings-storage` (update, no doc nuevo)** — alinear el copy con la Settings UX de PR #33:
   mencionar los botones de acción del equipo y la configuración de Service Account con el wording
   actual de la pantalla. Agregar tags: `equipo`, `service`, `account`, `cuenta`, `servicio`.

Restricción transversal: los docs solo pueden nombrar acciones de UI dentro de la unión real de
`ChatSuggestion.action` (`ChatProvider.ts:29-36`); acá solo se usa `open_settings`.

## Implementación (TDD: rojo → verde → refactor)

Tests en `apps/__tests__/web/integrations/` (carpeta espejo de `apps/web/src/integrations/`).

1. **Test rojo de retrieval** — `apps/__tests__/web/integrations/knowledgeCorpusRefresh.test.ts`:
   importa `retrieveKnowledgeSnippets` real y afirma que cada query de aceptación de la spec
   (`"¿cómo cambio el rol de un compañero?"`, `"¿quién puede gestionar el equipo?"`,
   `"soy admin o member?"`, `"¿por qué me redirigió a login?"`, `"¿mis datos están protegidos?"`,
   `"¿qué es RLS?"`, query de equipo/Service Account) devuelve el doc esperado (por `id`) dentro
   del topK=4. Rojo: los docs no existen.
2. **Test rojo de consistencia de acciones** — mismo archivo u otro test: extrae del `content` de
   todo el corpus los tokens estilo `snake_case` (`/[a-z]+(?:_[a-z]+)+/g`), resta el vocabulario
   conocido de estados de reunión (`waiting_admission`, `admission_timeout` — presentes en
   `meeting-lifecycle`) y afirma que el resto ⊆ unión de `ChatSuggestion.action`. Este test queda
   como red de drift para futuros docs.
3. **Verde de corpus** — agregar los 4 docs y el update de `settings-storage` en
   `documentCorpus.ts` según el diseño de arriba. Ajustar keywords hasta que el paso 1 pase; si una
   query no llega al topK, la palanca es sumar el token faltante a `tags`/`content` del doc
   correcto, nunca tocar el retriever (fuera de alcance).
4. **Test rojo de rol** — `apps/__tests__/web/integrations/userContextRole.test.ts`: mockea
   `WebMeetingRepository`/`WebSettingsRepository` (patrón de mocks existente en la suite) y afirma:
   (a) `buildUserContext({ role: "admin" })` incluye el rol admin; (b) ídem `member`;
   (c) `buildUserContext()` sin rol no lanza y produce contexto válido sin línea de rol;
   (d) con repos que rechazan (fallback del `catch`) y `role: "admin"`, el rol igual aparece.
5. **Verde de rol** — implementar la firma nueva en `userContext.ts` (línea de rol fuera del `try`,
   render en ambas ramas) y actualizar el call site: route.ts:78 →
   `buildUserContext({ role: session.user.role })`.
6. **Cierre** — `bun test apps/__tests__` (sin regresiones), `bun run typecheck`, `bun run lint`.
   Smoke manual: preguntar al chat local "¿quién puede gestionar el equipo?" y "¿mis datos están
   protegidos?" y verificar respuesta con el doc correcto.

## Decisiones

- **Rol por parámetro, no `auth()` interno** — ver tabla de la decisión central. Testabilidad
  trivial + la capa de conocimiento no conoce NextAuth. Alternativa (B) descartada.
- **Tipo `AuthorizedAccountRole` de `packages/shared`** — es la fuente única del union
  `"admin" | "member"` (AuthorizedAccountRepository.ts:5), el mismo que replica
  `next-auth.d.ts:7`. Evita un tercer union suelto.
- **Línea de rol fuera del `try/catch`** — el rol viene por parámetro, no de I/O; ponerla en ambas
  ramas garantiza el criterio de fallback sin reestructurar el manejo de errores existente.
- **Keywords derivadas de la tokenización real, no de intuición** — el retriever filtra stopwords y
  normaliza acentos; los tests de retrieval del paso 1 son el contrato que fija esto.
- **Sin cambios en `promptAssembler.ts`, tools, actions ni retriever** — reafirmado de la spec y de
  las decisiones del usuario (obs 951): tool surface intacto, RLS es hecho de deploy-time → corpus
  estático.

## Rollback

Revertir el PR. Contenido aditivo + un parámetro opcional con default: sin migraciones, sin env,
sin cambios de API pública. Cero riesgo de datos.

## Riesgos

- **Dilución del topK**: el corpus pasa de 14 a 18 docs; una query genérica podría desplazar al doc
  esperado fuera del topK=4. Mitigación: los tests de retrieval usan las queries reales de
  aceptación y fallan si eso pasa; la palanca es afinar tags del doc, no el retriever.
- **Solapamiento roles ↔ settings**: "equipo" aparece en `team-roles` y `settings-storage`.
  Aceptable: topK=4 admite ambos; los tests afirman presencia en topK, no posición #1.
- **Falso verde del test de consistencia**: la regex de `snake_case` podría no capturar una acción
  mal escrita con espacios. Aceptado: el test cubre el modo de fallo real (prometer una acción
  inexistente con su nombre técnico); el copy en prosa lo cubre la revisión de PR.
- **Drift futuro del corpus**: mismo riesgo que motivó esta feature. Mitigación parcial: el test de
  consistencia queda permanente; agregar al checklist de features "¿el corpus del chat necesita un
  doc nuevo?" (nota para el roadmap, no bloqueante de este cambio).
