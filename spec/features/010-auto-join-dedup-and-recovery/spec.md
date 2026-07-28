# 010 · Deduplicación de Auto-Join, Acceso Compartido y Recuperación de Transcripción

**Status:** spec (diseño decidido inline; no se corrió sdd-propose/explore)
**Branch:** `fix/auto-join-dedup-shared-access-transcription-recovery` (a partir de `dev`)

## Propósito

Tres bugs de producción independientes pero relacionados, cada uno confirmado contra código fuente real de
worker/web/shared mediante análisis de logs y exploración con CodeGraph:

1. **Bots de grabación duplicados** — una condición de carrera check-then-insert permite que dos polls
   concurrentes de auto-join encolen el mismo evento de calendario dos veces, por lo que el bot se une a
   una misma reunión en vivo dos veces.
2. **Los co-asistentes de auto-join pierden acceso** — después de la deduplicación, exactamente un
   asistente registrado se convierte en el `Owner` arbitrario; todos los demás asistentes registrados
   silenciosamente nunca ven la grabación. Una excepción de dominio acotada (ADR-0007) les otorga acceso
   automáticamente.
3. **Un fallo de transcripción oculta un video bueno** — la fase de post-procesamiento de IA corre después
   de que el video ya fue subido, pero su fallo colapsa en un `error` genérico, ocultando el video
   descargable y ofreciendo un reintento destructivo de reunión completa en vez del reintento correcto de
   reprocesamiento desde almacenamiento.

Este es un cambio de corrección de bugs con UNA excepción de dominio acotada y deliberada (Problema 2), no
una feature nueva. El vocabulario de dominio está fijado por `docs/CONTEXT.md` (secciones "Meeting
Ownership & Sharing" y "Meeting Status") y `docs/adr/0007-auto-join-co-attendee-automatic-access-grant.md`.
Esta spec usa esos términos exactos — **Owner**, **Access Grant**, **Participant**, **Auto-Join
Co-Attendee Grant**, **Meeting Status** — sin sinónimos.

---

## Problema 1 — Deduplicación atómica de encolados de auto-join

### Requisito: Unicidad a nivel de base de datos sobre la identidad del evento de calendario

El sistema DEBE forzar la unicidad de `(source_provider, source_event_id)` en la tabla `meetings` mediante
un índice único **parcial** restringido a `WHERE source_event_id IS NOT NULL` (parcial porque las
reuniones encoladas manualmente llevan `sourceEventId`/`sourceProvider` nulos). La aplicación de esta
regla DEBE vivir en la base de datos, no en lógica de aplicación check-then-insert.

- **Fuente:** `packages/shared/src/db/schema.ts:49-50` (columnas `text` planas, sin índice hoy).
- **Migración:** archivo nuevo, siguiente número después de `drizzle/0006_meeting_ownership_and_sharing.sql` →
  `drizzle/0007_*.sql`.

#### Escenario: Encolados concurrentes del mismo evento insertan exactamente una fila

- DADO que dos llamadores concurrentes invocan `queueMeetingRun` para el mismo `(sourceProvider, sourceEventId)`
- CUANDO ambos intentan insertar
- ENTONCES existe exactamente una fila de `meetings` para ese par
- Y el llamador perdedor devuelve el `meetingId` del ganador, no una segunda fila

#### Escenario: Las reuniones encoladas manualmente están exentas

- DADO dos reuniones encoladas manualmente con `sourceEventId` nulo
- CUANDO ambas se insertan
- ENTONCES ambas filas persisten (el índice parcial no restringe `source_event_id` nulo)

### Requisito: `queueMeetingRun` hace upsert en vez de check-then-insert

`queueMeetingRun` (`packages/shared/src/services/meetingQueueService.ts:39-53`) DEBE reemplazar el
`findBySourceEvent` + `insert` propenso a condición de carrera por `INSERT ... ON CONFLICT (source_provider,
source_event_id) DO NOTHING`, y luego, cuando el insert resulta en no-op, re-consultar y devolver el id del
ganador ya existente. Los dos disparadores que compiten entre sí (el timer interno del worker
`apps/worker/src/runner.ts:12,43-56` con `AUTO_JOIN_POLL_INTERVAL_MS` por defecto en 60000ms, y `GET
/api/bot/poll` → worker `/internal/auto-join/poll`, además del solape de rolling-deploy de Railway) NO
DEBEN volver a producir filas duplicadas. El claim atómico (`WorkerMeetingRepository.claimNextPending`,
`for update skip locked`) es correcto y DEBE permanecer sin cambios.

#### Escenario: Un segundo poll de un evento ya encolado deduplica hacia el ganador

- DADO que el evento E ya tiene una fila de `meetings` de un poll anterior
- CUANDO `queueMeetingRun` corre de nuevo para E
- ENTONCES no se inserta ninguna fila nueva y se devuelve el `meetingId` existente

**TDD:** test contra Postgres en vivo (NO módulo mockeado) que ejercita la restricción única bajo
concurrencia — siguiendo el precedente ya establecido en
`apps/__tests__/shared/repositories/user-repository.test.ts` y `meeting-access-grant-repository.test.ts`
(`createLiveConnection` de `@meeting-bot/shared/db/liveConnection` + `describe.skipIf(!dbAvailable)`),
porque `mock.module()` de Bun solo honra el primer registro por specifier por proceso y no puede testear
esta deduplicación de forma confiable en CI. Archivo de test nuevo/extendido:
`apps/__tests__/shared/services/meeting-queue-service.test.ts` (ruta live-DB).

---

## Problema 2 — Auto-Join Co-Attendee Grant (excepción ADR-0007)

### Requisito: Access Grant automático para co-asistentes registrados de reuniones auto-join

Acotado ÚNICAMENTE a reuniones originadas por auto-join (con `meetings.sourceProvider` y `sourceEventId`
seteados). Para cada email en `participantEmails` del evento de calendario
(`apps/worker/src/integrations/calendar/types.ts:18`, poblado desde `event.attendees` en
`GoogleCalendarProvider.ts:156-158`) que matchee un `users.email` registrado (`UserRepository.findByEmail`)
y que NO sea el `Owner` resuelto, el sistema DEBE crear una fila de `meeting_access_grants` vía
`MeetingAccessGrantRepository.create` **sin vencimiento** (indefinido, revocable manualmente como
cualquier otro grant). El `Owner` NO DEBE derivarse de `organizerEmail` (`docs/CONTEXT.md`: "No se deriva
de organizerEmail"). Esto corre en `apps/worker/src/services/autoJoinService.ts` justo después de que
`queueMeetingRun` retorna — ya sea que haya insertado o deduplicado — dado que un poll posterior puede ser
la primera vez que surge un email de co-asistente distinto.

Las reuniones encoladas manualmente (`INVITE_BOT`, `enqueue_meeting` de dashboard/chat) DEBEN quedar
completamente sin afectar: ahí `Participant` sigue siendo solo-sugerencia según el modelo de 009.

#### Escenario: Un asistente registrado que no es el owner recibe acceso auto-otorgado

- DADO una reunión auto-join donde los asistentes A y B son ambos usuarios registrados y A ganó la carrera
  de inserción como `Owner`
- CUANDO el servicio de auto-join procesa el evento
- ENTONCES se crea una fila de `meeting_access_grants` para B con `expiresAt` nulo
- Y B puede listar y abrir la reunión a pesar de no ser `Owner`

#### Escenario: El grant aplica incluso si el co-asistente nunca habilitó su propio auto-join

- DADO que el usuario registrado B aparece como asistente pero nunca conectó/habilitó el auto-join de
  Google Calendar
- CUANDO el servicio de auto-join procesa el evento disparador
- ENTONCES a B se le otorga acceso de todos modos (que el email matchee uno registrado es el único
  requisito)

#### Escenario: Los asistentes no registrados y el Owner se omiten

- DADO un email de asistente sin `users.email` que lo matchee, y el propio email del `Owner` resuelto
- CUANDO el servicio de auto-join procesa el evento
- ENTONCES no se crea ningún grant para el email no registrado ni tampoco para el `Owner`

### Requisito: Creación de grant idempotente y respetuosa de la revocación

La creación de grants DEBE ser idempotente a través de polls repetidos del mismo evento y NO DEBE recrear
un grant si YA existe cualquier fila para ese par `(meetingId, granteeUserId)` — incluso si el `Owner` lo
revocó manualmente. La verificación DEBE ser "¿existe alguna fila en absoluto?", NO "¿existe una fila
viva/no revocada?". Esto requiere un método de repositorio nuevo, por ejemplo
`MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, granteeUserId): Promise<boolean>`.

#### Escenario: Los polls repetidos no duplican grants

- DADO que B ya tiene una fila de grant en la reunión
- CUANDO el poller de auto-join (~60s) vuelve a escanear el mismo evento
- ENTONCES no se crea ninguna fila de grant adicional

#### Escenario: Un grant revocado deliberadamente no se resucita

- DADO que el `Owner` revocó manualmente el grant de B (`revokedAt` seteado)
- CUANDO corre un poll posterior del mismo evento
- ENTONCES el grant revocado NO DEBE recrearse

**TDD:** extender `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` (live-DB)
para `existsForMeetingAndGrantee`; nuevo `apps/__tests__/worker/services/autoJoinService.test.ts` (o
extender el test de auto-join existente) para la rama de creación de grant, el filtrado por email
matcheado, la exclusión del Owner y la idempotencia.

---

## Problema 3 — El fallo de transcripción es un estado recuperable, el video permanece visible

### Requisito: Nuevo status recuperable `transcription_error`

El sistema DEBE agregar un valor `transcription_error` a `meetingStatusEnum`
(`packages/shared/src/db/schema.ts`) mediante una migración aditiva `ALTER TYPE ... ADD VALUE` (dentro del
alcance de `drizzle/0007` o en su propio archivo numerado — aditiva, a diferencia del recreate de enum de
009). En `packages/shared/src/domain/meetingStatus.ts` DEBE agregarse a la unión `MeetingStatus`, a
`ALLOWED_TRANSITIONS` como **recuperable** (puede transicionar a `transcribing`/`summarizing`/`completed`,
a diferencia de los terminales `error`/`rejected`), y a `MEETING_STATUS_LABELS_ES` con la etiqueta `"Error
de transcripción"`. NO DEBE agregarse a `ACTIVE_PROCESSING_STATUSES` (es un estado accionable
cuasi-resuelto, del mismo grupo que `error`/`rejected`).

#### Escenario: transcription_error es recuperable, no terminal

- DADO una reunión en status `transcription_error`
- CUANDO se valida una transición a `transcribing`/`summarizing`/`completed`
- ENTONCES la transición se permite (mientras que `error`/`rejected` requieren reiniciar desde `pending`)

### Requisito: Un fallo de post-procesamiento de IA setea transcription_error, no error

En `apps/worker/src/services/meetingWorkerService.ts`, el video se sube y
`recordingFilePath`/`recordingStorageKey` se persisten (~líneas 120-126) ANTES de la fase de IA. Cuando la
fase de transcripción/resumen de IA lanza una excepción, su bloque catch (~líneas 165-173) DEBE setear
`status: "transcription_error"` en vez del `"error"` genérico. El catch externo para fallos reales de
grabación/unión (~líneas 174-193), donde nunca se produjo ningún video, DEBE mantener `"error"` — sin
cambios.

#### Escenario: Un fallo de IA después de una grabación buena produce transcription_error

- DADO una reunión cuyo video se subió exitosamente y `recordingFilePath` está seteado
- CUANDO la fase de transcripción/resumen de IA lanza una excepción
- ENTONCES el status pasa a `transcription_error` (no `error`)

#### Escenario: Un fallo de unión/grabación sigue produciendo error

- DADO una reunión que falló al unirse o grabar (no se produjo ningún video)
- CUANDO el catch externo la maneja
- ENTONCES el status permanece en `error`

### Requisito: La visibilidad del video se condiciona a la presencia del archivo, no al status completed

En `apps/web/src/components/MeetingDetailsView.tsx`, el reproductor de video (~línea 703) y el link de
descarga MP4 (~línea 656) DEBEN condicionarse a que `meeting.recordingFilePath` sea truthy en vez de
`status === "completed"`, para que un video almacenado se muestre sin importar el status.

#### Escenario: El video se muestra en transcription_error

- DADO una reunión en `transcription_error` con `recordingFilePath` seteado
- CUANDO el Owner abre la vista de detalle
- ENTONCES el reproductor de video y la descarga MP4 están disponibles

### Requisito: Se ofrece reprocesar (no una reunión completa nueva) para transcription_error

`canReprocess` DEBE ser adicionalmente `true` cuando `status === "transcription_error"` (además del
`status === "completed" && (!rawTranscription || !summary)` de hoy), todavía requiriendo que
`recordingFilePath` esté presente, reutilizando el cableado existente de
`handleReprocess`/`reprocessMeetingAction` (`MeetingDetailsView.tsx:116-133`) y `reprocessMeetingService`
(`meetingRecoveryService.ts:19-91`) tal cual — sin botón nuevo, sin acción nueva. El rollback por fallo de
`handleReprocess` (~líneas 120,125,129) DEBE restaurar el status previo al optimista de la reunión (ahora
posiblemente `transcription_error`) en vez de hardcodear `"completed"`. El reintento destructivo de reunión
completa (`status === "error" || "rejected"` → `retryMeetingAction` → `retryRejectedMeeting`,
`meetingRecoveryService.ts:94-110`, línea ~641) NO DEBE matchear `transcription_error`.

#### Escenario: Reprocesar reintenta desde almacenamiento sin volver a unirse

- DADO una reunión en `transcription_error` con `recordingFilePath` seteado
- CUANDO el Owner dispara el reprocesamiento
- ENTONCES `reprocessMeetingTranscription` reintenta la transcripción/resumen desde la grabación
  almacenada, sin volver a unirse jamás a la reunión en vivo

#### Escenario: Un reprocesamiento fallido restaura el status previo

- DADO una reunión en `transcription_error` cuyo reprocesamiento optimista falla
- CUANDO corre el rollback
- ENTONCES el status de la UI se restaura a `transcription_error`, no a `completed`

#### Escenario: transcription_error no ofrece el reintento destructivo de reunión completa

- DADO una reunión en `transcription_error`
- CUANDO la vista de detalle renderiza
- ENTONCES el botón de reunión completa nueva de `retryMeetingAction` NO DEBE aparecer

### Requisito: Filtrado y badge del dashboard para transcription_error

En `apps/web/src/components/DashboardClient.tsx`, `transcription_error` DEBE plegarse dentro de la pestaña
de filtro de status "Con Error" existente (sin pestaña nueva) y DEBE renderizarse con una variante de badge
distinta de la de `error` plano (por ejemplo, `"warning"` en vez de `"destructive"`), dado que la grabación
está bien y solo el post-procesamiento necesita un reintento.

#### Escenario: transcription_error aparece bajo el filtro de error con un badge warning

- DADO una reunión en `transcription_error`
- CUANDO el filtro "Con Error" del dashboard está activo
- ENTONCES la reunión aparece con un badge de variante `warning`, distinto del `destructive` de `error`

**TDD:** extender `apps/__tests__/shared/domain/meetingStatus.test.ts` para las aserciones de
unión/transiciones/label/active-set; extender el test del servicio del worker para el status del bloque
catch; las condiciones de gating del componente web y las aserciones de `canReprocess`/rollback pertenecen
al área de test web espejo (`apps/__tests__/web/...`) según el mandato TDD de AGENTS.md. El estilado
puramente visual del badge cae bajo la excepción manual/visual.

---

## No-objetivos

- **Rehacer el claim atómico** (`claimNextPending`) — ya es correcto (`for update skip locked`).
- **Selección del Owner por el organizador del calendario** — `Owner` sigue decidido por la carrera;
  `organizerEmail` NO DEBE determinarlo.
- **Auto-grants para reuniones encoladas manualmente** — `INVITE_BOT`/dashboard/chat siguen siendo
  solo-sugerencia (009).
- **Auto-grants para asistentes no registrados** — solo califican los matches con `users.email` registrado.
- **Backfill de grants para reuniones auto-join históricas** — el comportamiento aplica hacia adelante.
- **Tocar archivos del contrato de despliegue** — sin cambios a `Dockerfile.*`, `docker-compose*.yml`,
  `railway.json`, ni a CI.

## Nota de migración

Las migraciones aterrizan como `drizzle/0007_*.sql` (índice único parcial en `meetings (source_provider,
source_event_id) WHERE source_event_id IS NOT NULL`, más el `ALTER TYPE meeting_status ADD VALUE
'transcription_error'` aditivo). Agregar un valor de enum es directo y no requiere recrear el tipo (a
diferencia de 009, que lo recreó para eliminar un valor). Las filas `error` preexistentes no se
reclasifican retroactivamente.
