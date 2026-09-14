# Plan · 015 Cierre de la superficie de autorización

## Estrategia

Cambio quirúrgico de cinco rutas, sin tocar el modelo de datos, sin migraciones y sin tocar el contrato
de despliegue. La regla de visibilidad no se reimplementa: se reutiliza
`WebMeetingRepository.findByIdForUser()`, que ya encapsula owner + Access Grant vivo + owner activo.

TDD: primero los tests que fallan (cada uno demuestra la vulnerabilidad), después el código mínimo para
pasarlos, y por último la suite completa en verde.

## Decisiones de diseño

### 1. IDOR de `/api/meetings/[id]` — sesión y máquina son caminos distintos

La ruta tiene **dos** vías de entrada legítimas con reglas distintas, y hay que separarlas:

| Vía | Regla | Motivo |
|---|---|---|
| Session Auth | `findByIdForUser(userId, id)` → owner o grant | Es la regla del dashboard; la misma que `visibleToUser()` |
| `Bearer API_ROUTE_SECRET` | sin scoping de ownership | Server-to-server de confianza (el worker lee reuniones que no "posee") |

Por eso el scoping se aplica **sólo** en la rama de sesión. Aplicarlo a la rama máquina rompería el
pipeline del worker, que es exactamente la regresión que la constitución prohíbe.

Se devuelve **404, no 403**, cuando la reunión existe pero no es visible: no se filtra la existencia de
ids ajenos.

### 2. IDOR de la extensión — alinear con el dashboard (owner **o** grant)

El hermano `/status` usa `findTrackableByUrlAndOwner` (owner-only) y eso ya causa un bug conocido: el
dashboard lista reuniones compartidas que la extensión reporta como `active: false`. Esta feature **no**
replica ese sesgo: usa la regla owner-o-grant, que es la documentada. El sesgo del `/status` se corrige
en su propia feature para no mezclar dos cambios de comportamiento.

El `userId` del token de extensión es el mismo `users.id` de la sesión
(`link-token/route.ts:10-18` lo toma de `session.user.id`), así que `findByIdForUser` es directamente
aplicable.

### 3. `/api/settings` — sesión + allowlist, no sólo sesión

Exigir sesión cierra el ataque anónimo, pero la ruta seguiría aceptando **cualquier** clave. Como la tabla
`settings` aloja el contexto y el diccionario de IA que se inyectan en los prompts, se añade una allowlist
explícita. El único consumidor real es la pestaña General (`SettingsView.tsx:209`), que escribe
`monitor_email`; el contexto IA tiene su propia ruta (`/api/settings/transcription`). La allowlist es, por
tanto, de una sola clave y no rompe nada.

### 4. `/api/settings/google-credentials` — sesión en los tres verbos

Se exige Session Auth en `GET`, `POST` y `DELETE`. **No** se exige rol admin en este cambio: la sección
de credenciales se renderiza en la pestaña General, visible para members, así que admin-gatearla sería un
cambio de permisos de producto colateral. Queda declarado en el spec como decisión pendiente de la
persona.

### 5. `/api/bot/poll` — secreto compartido

Se reutiliza `assertPrivateApiAuthorized` (el mismo helper que `/api/meetings/status` y `/api/bot/start`),
que es el patrón sancionado para rutas internas. Sin llamadores dentro del repo, así que el riesgo de
regresión es nulo; un cron externo sigue funcionando enviando el Bearer.

### 6. Lo que deliberadamente NO se toca

- `privateApiAuth.ts` fail-open → decisión de la persona (puede tumbar el canal web↔worker).
- Rol admin para settings globales → decisión de permisos de producto.
- Cualquier ruta fuera de las cinco auditadas.

## Ficheros afectados

| Fichero | Cambio |
|---|---|
| `apps/web/src/app/api/meetings/[id]/route.ts` | scoping en la rama de sesión |
| `apps/web/src/app/api/v1/extension/meetings/[id]/route.ts` | scoping por `auth.payload.userId` |
| `apps/web/src/app/api/settings/route.ts` | sesión + allowlist de claves |
| `apps/web/src/app/api/settings/google-credentials/route.ts` | sesión en GET/POST/DELETE |
| `apps/web/src/app/api/bot/poll/route.ts` | `assertPrivateApiAuthorized` |
| `apps/web/src/repositories/WebMeetingRepository.ts` | (sin cambios: se reutiliza lo existente) |
| `apps/__tests__/web/routes/*` | tests nuevos de autorización + ajuste de los existentes |

**Módulo puro nuevo:** `apps/web/src/lib/apiAuthGuards.ts` con las reglas de decisión puras
(qué claves son editables, si una petición está autenticada), para poder testearlas sin mockear el ciclo
request/response, siguiendo el patrón ya usado en `lib/pageAuthGuard.ts`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Romper el worker por scopear la rama máquina | La rama `Bearer API_ROUTE_SECRET` no se scopea; hay test que lo fija |
| Romper la extensión | Test de owner y de ajeno; la regla es la del dashboard, más permisiva que la de `/status` |
| Romper el guardado de `monitor_email` | Test explícito de la clave de la allowlist |
| Los tests existentes de storage keys mockean una sesión sin `id` | Se actualizan para incluir `id` (hoy codifican el comportamiento vulnerable) |

## Verificación

1. `bun test apps/__tests__/web/routes` — rojo antes, verde después.
2. `bun run test` (con `--isolate`) — sin regresiones.
3. `bun run lint` y `bun run typecheck`.
4. `bun run build:web`.
5. Revisión de frontera (Astra) antes de dar el cambio por terminado.
