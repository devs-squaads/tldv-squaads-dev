# Tareas: Meeting Ownership & Personalized Sharing (+ Nomenclatura S3)

## Pronóstico de carga de revisión

| Campo | Valor |
|-------|-------|
| Líneas modificadas estimadas | ~2000-2100 (7 unidades de trabajo, ~120-400 cada una) |
| Riesgo de presupuesto de 400 líneas | Alto |
| PRs encadenados recomendados | Sí |
| División sugerida | PR1 → {PR2, PR3, PR4, PR7 en paralelo} → {PR5 → PR6} |
| Estrategia de entrega | ask-on-risk (por defecto, no se especificó ninguna) |
| Estrategia de encadenamiento | feature-branch-chain (resuelto — confirmado por la estructura de ramas: `feat/009-02-owner-capture` creada a partir de `feat/009-01-schema`, sobre el tracker `feat/009-meeting-ownership-sharing`) |

Decisión necesaria antes de aplicar: No — resuelto como feature-branch-chain
PRs encadenados recomendados: Sí
Estrategia de encadenamiento: feature-branch-chain
Riesgo de presupuesto de 400 líneas: Alto

### Unidades de trabajo sugeridas

| Unidad | Objetivo | PR probable | Comando de test enfocado | Harness de runtime | Límite de rollback |
|---|---|---|---|---|---|
| 1 | Esquema + migración + `UserRepository` | PR1 (base) | `bun test apps/__tests__/shared/repositories/user-repository.test.ts` | `bun run infra:reset` | Revertir schema.ts, el archivo de migración, UserRepository.ts |
| 2 | Captura de Owner en todos los paths de creación | PR2 (necesita PR1) | `bun test apps/__tests__/shared/services/meeting-queue-service.test.ts apps/__tests__/web/api/bot-start.test.ts` | `bun run dev` — encolar vía dashboard/extensión | Revertir queueMeetingRun/EnqueueMeetingCommand/rutas de bot |
| 3 | Lecturas acotadas por ownership | PR3 (necesita PR1, en paralelo con PR2) | `bun test apps/__tests__/web/repositories/web-meeting-repository.test.ts` | N/A — capa de queries, cubierto por unit tests | Revertir WebMeetingRepository.ts + los callers de páginas |
| 4 | Access Grants (repo/service/action) | PR4 (necesita PR1, en paralelo con PR2/3) | `bun test apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts apps/__tests__/web/services/meeting-access-grant-service.test.ts` | N/A — capa de servicio, cubierto por unit tests | Revertir shareTtl.ts, MeetingAccessGrantRepository/Service, grants.ts |
| 5 | Retrofit de autorización de share | PR5 (necesita PR4) | `bun test apps/__tests__/web/services/meeting-share-service.test.ts` | N/A — capa de servicio, cubierto por unit tests | Revertir el chequeo de callerId en meetingShareService.ts, shares.ts |
| 6 | Eliminar share público + sugerencias de participant | PR6 (necesita PR2, PR4, PR5) | `bun test apps/__tests__/web/integrations/chat-tools-definitions.test.ts` | `bun run dev:web` — recorrido manual de la UI de sharing | Revertir sharing types/Factory/borrar archivo, MeetingDetailsView.tsx, definitions.ts |
| 7 | Nomenclatura de storage key de S3 | PR7 (necesita solo PR1, totalmente en paralelo) | `bun test apps/__tests__/shared/meeting-provider.test.ts` | `bun run dev:worker` — grabar+subir, verificar que la clave se persistió | Revertir los agregados de meetingProvider.ts + los 6 sitios de resolve-then-fallback |

PR2/PR4 están cerca del límite de 400 líneas; dividir más al momento de aplicar si el diff real lo supera.

## Fase 1: Fundamento de esquema y migración

- [x] 1.1 `packages/shared/src/db/schema.ts`: agrega `meetings.ownerId` (FK NOT NULL a users.id), `recordingStorageKey`, `participantEmails`; nueva tabla `meetingAccessGrants`; `shareTypeEnum` elimina `"public"`.
- [x] 1.2 `drizzle/0006_meeting_ownership_and_sharing.sql`: revoca y reetiqueta las filas `"public"` existentes, recrea el enum `share_type`, agrega las nuevas columnas/tabla.
- [x] 1.3 RED+GREEN: `packages/shared/src/repositories/UserRepository.ts` (`findByEmail`) + `apps/__tests__/shared/repositories/user-repository.test.ts`.
- [x] 1.4 Aplicar la migración vía `bun run infra:reset` + `bun run db:push`; se confirmó que el esquema carga limpio contra una DB local nueva (2026-07-20). No se reutilizaron contenedores de meeting/db preexistentes — los contenedores obsoletos de una sesión anterior (`meeting-db`, `meeting-storage`, `meeting-storage-mc`, `meeting-worker`) se eliminaron primero porque entraban en conflicto con `docker compose up`.

## Fase 2: Captura de Owner en la creación

- [x] 2.1 RED+GREEN: `meetingQueueService.ts` — `ownerId` obligatorio, `participantEmails` opcional, propagado hasta el insert — `apps/__tests__/shared/services/meeting-queue-service.test.ts`.
- [x] 2.2 Propagar `ownerId`: `EnqueueMeetingCommand.ts`, `meetingService.ts`, `app/actions/bot.ts` (sesión, 401 sin `session.user.id`), `api/v1/extension/bot/start/route.ts` (`auth.payload.userId`, sin lógica nueva). Se agregó RED+GREEN para la nueva rama de no autorizado de `bot.ts` (`apps/__tests__/web/actions/bot-start-action.test.ts`), más allá del mínimo del plan, porque introduce lógica condicional real.
- [x] 2.3 RED+GREEN: el `api/bot/start/route.ts` legacy exige `ownerEmail`, resuelve vía `UserRepository.findByEmail`, 400 si falta o es desconocido — `apps/__tests__/web/api/bot-start.test.ts`.
- [x] 2.4 `apps/worker/src/integrations/calendar/types.ts`: `CalendarMeetingEvent` gana `ownerUserId`, `participantEmails`. Implementado como campos opcionales (`ownerUserId?: string`, `participantEmails?: string[]`) en lugar de obligatorios — necesario para la corrección de tipos, ya que la propia tabla de estrategia de testing dice que el path de fallback de service-account "no produce ownerUserId".
- [x] 2.5 RED+GREEN: `GoogleCalendarProvider.ts` estampa `ownerUserId` por usuario OAuth, mapea `event.attendees` — `apps/__tests__/worker/calendar/google-calendar-provider.test.ts`.
- [x] 2.6 RED+GREEN: `autoJoinService.ts` propaga `ownerId`/`participantEmails` en el path primario, se salta y loguea en el fallback por env sin Owner — `apps/__tests__/worker/shared/auto-join-service.test.ts`.

También se implementó antes de lo previsto (pedido explícitamente junto con la Fase 2, fuera del orden
de fases del propio tasks.md): la mitad de `enqueue_meeting` de la tarea 6.3 — el
`enqueueMeetingTool.execute` de `integrations/chat/tools/definitions.ts` ahora resuelve
`getServerSession(authOptions)` y setea `ownerId` desde `session.user.id`, rechazando con un resultado
de error estructurado cuando no hay autenticación — RED+GREEN en
`apps/__tests__/web/integrations/chat-tools-definitions.test.ts`. La eliminación de `"public"` en
`manage_meeting_share` y el ruteo al grant-service (el resto de 6.3) sigue sin tocarse — todavía es
alcance de la Fase 6.

## Fase 3: Visibilidad acotada por ownership

- [x] 3.1 RED+GREEN: `WebMeetingRepository.ts` — WHERE de owner-o-grant-vigente, unido a `authorized_accounts.isActive`, sin bypass de rol — `apps/__tests__/web/repositories/web-meeting-repository.test.ts`.
- [x] 3.2 Propagar `session.user.id` a los callers de lista/detalle de reunión bajo `apps/web/src/app/(main)/`.

## Fase 4: Access Grants

- [x] 4.1 Extraer `shareTtl.ts` (`DEFAULT_SHARE_TTL_OPTIONS_MINUTES` + helpers) de `meetingShareService.ts`.
- [x] 4.2 RED+GREEN: `MeetingAccessGrantRepository.ts` (create/findById/listByMeetingId/findLiveGrant/revokeById) — `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts`.
- [x] 4.3 RED+GREEN: `meetingAccessGrantService.ts` (`createGrant`/`listGrantsByMeetingId`/`revokeGrant`, `callerId === meeting.ownerId`) — `apps/__tests__/web/services/meeting-access-grant-service.test.ts`.
- [x] 4.4 `app/actions/grants.ts`: `createGrantAction`/`revokeGrantAction` (exclusivo del Owner).

## Fase 5: Retrofit de autorización de share

- [x] 5.1 RED+GREEN: `meetingShareService.ts` — `createShare` exige `callerId === meeting.ownerId`, elimina la rama `"public"`, URL firmada con resolve-then-fallback — `apps/__tests__/web/services/meeting-share-service.test.ts`.
- [x] 5.2 `app/actions/shares.ts`: `createShareAction` resuelve la sesión, pasa `callerId`.

## Fase 6: Eliminar el tipo de share público + sugerencias de Participant

- [x] 6.1 Eliminar `"public"`: `sharing/types.ts`, `SharingProvider.ts`, `SharingProviderFactory.ts`; borrar `PublicSharingProvider.ts`. También se corrigió la validación M2M de `app/api/v1/shares/route.ts` (todavía comparaba `body.shareType` contra el literal `"public"` — una consecuencia directa del cambio de tipo, no estaba en la lista original de archivos pero era necesaria para un typecheck limpio).
- [x] 6.2 `MeetingDetailsView.tsx`: se eliminó la opción/estado/render público (toggle de shareType, diálogos de confirmación públicos, bloque de shares públicos); se agregó una lista de sugerencias por participant renderizada a partir del nuevo prop `participantSuggestions` (resuelto en el server por el nuevo `ParticipantSuggestionService`, RED+GREEN en `apps/__tests__/web/services/participant-suggestion-service.test.ts`) con confirmar-para-otorgar (`createGrantAction`) o confirmar-para-compartir (`createShareAction`, restricted_email) individual por fila — nunca una acción masiva. Las reuniones ad-hoc (sugerencias vacías) degradan al campo existente de ingreso manual de email, ahora incondicionalmente restricted_email.
- [x] 6.3 RED+GREEN: `integrations/chat/tools/definitions.ts` — `enqueue_meeting` setea `ownerId` desde la sesión (hecho en la Fase 2); `manage_meeting_share` elimina `"public"` de sus args/schema y rutea `create`/`revoke` a través de `MeetingShareService.createShare`/`revokeShare` (exclusivo del Owner) en lugar de llamar directamente a `MeetingShareRepository`, resolviendo `callerId` vía `getServerSession` — se extendió `apps/__tests__/web/integrations/chat-tools-definitions.test.ts`.

## Fase 7: Nomenclatura de la storage key de la grabación

- [x] 7.1 RED+GREEN: `meetingProvider.ts` — `sanitizeMeetingNameForStorageKey`, `buildNamedRecordingStorageKey` — `apps/__tests__/shared/meeting-provider.test.ts`.
- [x] 7.2 RED+GREEN: `meetingWorkerService.ts` persiste `recordingStorageKey` en la subida — extender su test.
- [x] 7.3 RED+GREEN: resolve-then-fallback (`recordingStorageKey ?? buildRecordingStorageKey()`) en `meetingRecoveryService.ts`, `DeleteMeetingCommand.ts`, `api/meetings/[id]/route.ts`, `api/v1/extension/meetings/[id]/route.ts`, `(main)/meeting/[id]/page.tsx` — extender el test existente de cada archivo (ninguno preexistía para estos 5 sitios; se crearon nuevos archivos de test enfocados siguiendo la convención `mock.module` del codebase).

## Fase 8: Verificación

- [ ] 8.1 `bun test apps/__tests__` en verde en todas las suites nuevas/modificadas.
- [ ] 8.2 `bun run lint && bun run typecheck && bun run build:web`.
- [ ] 8.3 Recorrido manual: eliminación de share público, sugerencias por participant, sin sugerencias en ad-hoc, bloqueo por Owner desactivado.
