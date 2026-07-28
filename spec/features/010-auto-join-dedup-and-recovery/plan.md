# Diseño: Deduplicación de Auto-Join, Acceso Compartido y Recuperación de Transcripción

## Enfoque técnico

Tres fixes de causa raíz independientes, cada uno aterrizando en el único cuello de botella por el que ya
converge cada ruta de código afectada — consistente con el enfoque de 009, no tres parches dispersos:

1. **La deduplicación** pasa de un check-then-insert a nivel de aplicación propenso a condición de carrera,
   a un índice único parcial a nivel de base de datos + `INSERT ... ON CONFLICT DO NOTHING` en
   `MeetingRepository`, con `queueMeetingRun` re-consultando al ganador en caso de conflicto. El claim
   atómico (`claimNextPending`, `for update skip locked`) queda intacto — esto corrige la duplicación en
   tiempo de encolado, no en tiempo de claim.
2. **El grant de co-asistente** es una escritura nueva, acotada estrechamente, agregada a `autoJoinService`
   justo después de que `queueMeetingRun` resuelve (insertado o deduplicado), reutilizando
   `UserRepository.findByEmail` y `MeetingAccessGrantRepository.create` de 009 tal cual, más un nuevo
   método de verificación de idempotencia. La resolución del Owner en sí queda sin cambios.
3. **La recuperación de transcripción** agrega un valor de enum (`transcription_error`) tratado como
   recuperable (no terminal) en el módulo de máquina de estados existente, y re-apunta cuatro gates de UI
   ya existentes (video, descarga, `canReprocess`, rollback) de `status === "completed"` hacia la
   presencia de `recordingFilePath` / verificaciones inclusivas de status — sin componente nuevo, sin
   server action nueva.

## Pregunta técnica abierta — Resuelta: dividir en dos archivos de migración

**Pregunta:** ¿Pueden el índice único parcial y el nuevo valor de enum `transcription_error` salir en un
solo `drizzle/0007_*.sql`, dado que Postgres prohíbe `ALTER TYPE ... ADD VALUE` y usar ese valor en la
misma transacción?

**Hallazgo:** El precedente ya existente en este repo para agregar valores de enum,
`drizzle/0001_add_rejected_status.sql`, es un archivo de una sola sentencia que contiene únicamente `ALTER
TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'rejected';` — aislado de cualquier otra migración,
aun cuando nada más en ese batch de migración referenciaba el valor nuevo. `drizzle/0006_meeting_ownership_and_sharing.sql`
muestra que el runner de migraciones de este repo ejecuta juntas las sentencias de cada archivo numerado
(separadas por `--> statement-breakpoint`), y el aislamiento de `0001` es el único dato previo sobre cómo
este repo trata `ADD VALUE`. Nada en este cambio necesita que el índice único parcial y el valor de enum
coexistan — son objetos de schema no relacionados que tocan tablas distintas — así que no hay ningún
requisito de corrección para combinarlos, y la opción segura y consistente con la convención es mantener el
precedente de aislamiento para migraciones `ADD VALUE`.

**Decisión:** Dividir en dos archivos:
- `drizzle/0007_meeting_dedup_index.sql` — solo el índice único parcial.
- `drizzle/0008_transcription_error_status.sql` — solo `ALTER TYPE "public"."meeting_status" ADD VALUE IF
  NOT EXISTS 'transcription_error';`, reflejando exactamente la forma de `0001`.

Esto también evita cualquier ambigüedad sobre si el runner de este repo envuelve un archivo completo en
una sola transacción (si lo hace, combinar produciría un error duro de Postgres en el momento en que algo
del mismo archivo referenciara el valor nuevo — discutible acá, pero no vale la pena introducirlo como
precedente) o no.

## Decisiones de arquitectura

| Decisión | Elección | Alternativas consideradas | Justificación |
|---|---|---|---|
| División de archivos de migración | Dos archivos, `0007` (índice) + `0008` (valor de enum), siguiendo el precedente de aislamiento de `0001` | Un `0007` combinado | No hay requisito de corrección para combinar; coincide con el único precedente previo de `ADD VALUE` de este repo en vez de inventar un patrón nuevo |
| Punto de aplicación de la deduplicación | Índice único parcial a nivel de DB + `ON CONFLICT DO NOTHING`, lógica de árbitro dentro de `MeetingRepository` | Lock advisory en `queueMeetingRun`; re-chequeo a nivel de aplicación antes de insertar (el enfoque propenso a condición de carrera de hoy) | Fix de causa raíz según AGENTS.md — la restricción de DB es el único mecanismo inmune a que dos procesos compitan entre el check y el insert; `MeetingRepository` ya posee cualquier otra preocupación de forma de query (refleja `findBySourceEvent`, `insert`), manteniendo a `queueMeetingRun` libre de detalles de SQL/conflict-target |
| Construcción del conflict-target | Query builder de Drizzle `.onConflictDoNothing({ target: [...], where: isNotNull(...) })`, no SQL crudo | SQL crudo `db.execute(sql\`INSERT ... ON CONFLICT ...\`)` | Cualquier otro método de repositorio en este archivo usa el query builder; SQL crudo sería la única excepción sin ninguna ganancia de corrección — Postgres requiere que el `where` del árbitro coincida exactamente con el predicado del índice parcial sin importar qué API de drizzle lo construya |
| Forma del retorno de `queueMeetingRun` | Extenderlo a `{ id: string; ownerId: string }` | Que `autoJoinService` re-consulte la reunión por id para conocer el `ownerId` ganador | Los métodos de repositorio ya tienen a mano la fila ganadora (recién insertada o re-consultada por conflicto); devolverla evita un segundo round-trip y evita que `autoJoinService` necesite conocer nada de `MeetingRepository` |
| Verificación de idempotencia del grant de co-asistente | Nuevo `MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, granteeUserId)` — "cualquier fila en absoluto", ignorando `revokedAt` | Reutilizar `findLiveGrant` (verifica `revokedAt IS NULL`) | La spec requiere que un grant revocado manualmente siga revocado; la semántica de `findLiveGrant` es la pregunta equivocada (verifica "¿está vivo actualmente?", no "¿alguna vez se creó?") — un método distinto mantiene a ambas queries honestas sobre lo que responden |
| Ubicación de la creación del grant | Inline en el loop por-evento de `autoJoinPollAndEnqueue`, justo después de que `queueMeetingRun` resuelve | Módulo nuevo `AutoJoinGrantService` | YAGNI — un loop, dos llamadas a repositorio, sin complejidad de branching que justifique un archivo nuevo; refleja cómo la resolución del owner ya vive inline en la misma función |
| Grupo de `transcription_error` | Grupo propio junto a `error`/`rejected` (accionable, no `ACTIVE_PROCESSING_STATUSES`), pero recuperable en `ALLOWED_TRANSITIONS` (a diferencia de `error`/`rejected`, que solo se recuperan vía `pending`) | Agregarlo a `ACTIVE_PROCESSING_STATUSES` (dispararía espuriamente el `setInterval` de polling del dashboard) | La grabación ya está lista; solo la transcripción/resumen necesita otra pasada, así que debería comportarse como un estado resuelto-pero-accionable, no uno en progreso |
| Gating de video/descarga/`canReprocess` | Cambiar a truthiness de `meeting.recordingFilePath` (video/descarga) y verificaciones explícitas de conjunto de status (`canReprocess`) en vez de `status === "completed"` | Agregar `transcription_error` como una rama `||` paralela en todos lados donde aparece `completed` | La truthiness sobre la presencia del archivo es el invariante real que le importa a la UI ("¿hay un video para mostrar?"), y ya es correcta para cualquier futuro status recuperable-con-video sin otra rama `||` |
| Status de rollback en un reprocesamiento fallido | Capturar `meeting.status` en el momento en que `handleReprocess` arranca (antes del set optimista a `"transcribing"`), restaurar ese valor capturado en caso de fallo | Mantener `"completed"` hardcodeado y agregar un `if` para `transcription_error` | Un valor pre-optimista capturado es correcto para ambos llamadores existentes de `canReprocess` (`completed` y ahora `transcription_error`) con una sola línea, no dos ramas hardcodeadas que hay que mantener sincronizadas |

## Flujo de datos

    Poll de auto-join (worker/src/services/autoJoinService.ts, ~60s + /internal/auto-join/poll)
      │
      ▼
    queueMeetingRun({ sourceProvider, sourceEventId, ownerId: event.ownerUserId, ... })
      │
      ├─ sourceProvider && sourceEventId seteados ──▶ MeetingRepository.insertDedupedBySourceEvent(values)
      │                                            │
      │                                            ├─ INSERT ... ON CONFLICT (source_provider, source_event_id)
      │                                            │   WHERE source_event_id IS NOT NULL DO NOTHING RETURNING *
      │                                            │
      │                                            ├─ se devuelve fila ──▶ esta llamada ganó la carrera
      │                                            └─ sin fila ──▶ findBySourceEvent(...) ──▶ fila del ganador
      │                                            (en cualquier caso: { id, ownerId } de la ÚNICA fila persistida)
      │
      └─ rutas manuales (sin sourceEventId) ──▶ ventana de deduplicación existente + insert plano, sin cambios

    { id: meetingId, ownerId: resolvedOwnerId } = queueMeetingRun(...)
      │
      ▼
    for email of event.participantEmails:
      UserRepository.findByEmail(email) ──▶ user | null
      user && user.id !== resolvedOwnerId
        ──▶ MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, user.id)
              false ──▶ MeetingAccessGrantRepository.create({ meetingId, ownerId: resolvedOwnerId,
                          granteeUserId: user.id, expiresAt: null, revokedAt: null })
              true  ──▶ omitir (ya otorgado, o deliberadamente revocado — nunca se recrea)

    La fase de IA del worker lanza excepción (meetingWorkerService.ts, DESPUÉS de que el upload tuvo éxito)
      ──▶ status: "transcription_error" (antes "error")
    La fase de unión/grabación del worker lanza excepción (nunca se produjo ningún video)
      ──▶ status: "error" (sin cambios)

    MeetingDetailsView renderiza:
      recordingFilePath truthy ──▶ reproductor de video + descarga MP4 mostrados (cualquier status)
      status ∈ {completed, transcription_error} && (falta transcripción/resumen) && recordingFilePath
        ──▶ canReprocess ──▶ handleReprocess ──▶ reprocessMeetingAction (sin cambios, reintento basado en almacenamiento)
      status ∈ {rejected, error} (NO transcription_error) ──▶ retryMeetingAction (reunión completa nueva, destructiva)

    DashboardClient: transcription_error se pliega dentro de la pestaña de filtro "Con Error", renderiza con badge "warning"
      (no "destructive") — la grabación está bien, solo el post-procesamiento necesita un reintento.

## Cambios de archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/shared/src/db/schema.ts` | Modificar | `meetingStatusEnum` gana `"transcription_error"` (el orden después de `"error"`, antes de `"rejected"`, es irrelevante para los enums de Postgres pero se mantiene adyacente a `"error"` por legibilidad); agregar índice único parcial en `meetings(sourceProvider, sourceEventId)` vía el builder `index()` al estilo `.enableRLS()` con `.where(...)` |
| `drizzle/0007_meeting_dedup_index.sql` | Crear | `CREATE UNIQUE INDEX ... ON "meetings" ("source_provider", "source_event_id") WHERE "source_event_id" IS NOT NULL;` |
| `drizzle/0008_transcription_error_status.sql` | Crear | `ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'transcription_error';` (refleja a `0001`) |
| `packages/shared/src/repositories/MeetingRepository.ts` | Modificar | Nuevo `insertDedupedBySourceEvent(values): Promise<MeetingRecord>` — `onConflictDoNothing` + re-consulta en caso de conflicto |
| `packages/shared/src/services/meetingQueueService.ts` | Modificar | El tipo de retorno de `queueMeetingRun` pasa a ser `{ id: string; ownerId: string }`; la rama de source-event llama a `insertDedupedBySourceEvent` en vez de `findBySourceEvent` + `insert` |
| `packages/shared/src/repositories/MeetingAccessGrantRepository.ts` | Modificar | Nuevo `existsForMeetingAndGrantee(meetingId, granteeUserId): Promise<boolean>` |
| `apps/worker/src/services/autoJoinService.ts` | Modificar | Después de que `queueMeetingRun` resuelve: loop sobre `event.participantEmails`, resolver vía `UserRepository.findByEmail`, omitir `Owner`/no-registrado/ya-otorgado, crear grant |
| `packages/shared/src/domain/meetingStatus.ts` | Modificar | La unión `MeetingStatus`, `ALLOWED_TRANSITIONS` y `MEETING_STATUS_LABELS_ES` ganan `transcription_error`; `ACTIVE_PROCESSING_STATUSES` sin cambios (NO lo incluye) |
| `apps/worker/src/services/meetingWorkerService.ts` | Modificar | El bloque catch interno de la fase de IA (~línea 165-173) setea `status: "transcription_error"` en vez de `"error"`; el catch externo (~174-193, fallos de unión/grabación) sin cambios |
| `apps/web/src/components/MeetingDetailsView.tsx` | Modificar | El gate de video (~703) y el gate de descarga MP4 (~656) cambian de `status === "completed"` a `meeting.recordingFilePath` truthy; `canReprocess` (~116) agrega `transcription_error`; `handleReprocess` (~118-133) captura el status pre-optimista para el rollback en vez de hardcodear `"completed"` |
| `apps/web/src/components/DashboardClient.tsx` | Modificar | `getStatusVariant` (~40-50) devuelve `"warning"` para `transcription_error`; el predicado de filtro (~85-89) pliega `transcription_error` dentro de la pestaña `"error"` junto con `m.status === "error"` |

## Interfaces / Contratos

```typescript
// packages/shared/src/repositories/MeetingRepository.ts
import { isNotNull } from "drizzle-orm";

export class MeetingRepository {
  // ...existing methods unchanged...

  /**
   * Atomically inserts a meeting keyed by (sourceProvider, sourceEventId), relying on the
   * partial unique index. On conflict (event already enqueued by a concurrent poll), re-fetches
   * and returns the existing winner instead of inserting a duplicate row.
   */
  static async insertDedupedBySourceEvent(values: MeetingInsert): Promise<MeetingRecord> {
    const [inserted] = await db
      .insert(meetings)
      .values(values)
      .onConflictDoNothing({
        target: [meetings.sourceProvider, meetings.sourceEventId],
        where: isNotNull(meetings.sourceEventId), // mirrors the partial index predicate
      })
      .returning();

    if (inserted) return inserted;

    const existing = await MeetingRepository.findBySourceEvent(
      values.sourceProvider as string,
      values.sourceEventId as string,
    );
    if (!existing) {
      throw new Error(
        `insertDedupedBySourceEvent: conflict reported but no existing row found for ${values.sourceProvider}/${values.sourceEventId}`,
      );
    }
    return existing;
  }
}
```

```typescript
// packages/shared/src/services/meetingQueueService.ts
export async function queueMeetingRun(params: StartMeetingParams): Promise<{ id: string; ownerId: string }>;
// Source-event branch (sourceProvider && sourceEventId && !meetingId):
//   const record = await MeetingRepository.insertDedupedBySourceEvent({ id, ownerId, ...rest });
//   return { id: record.id, ownerId: record.ownerId };
// All other branches (existing manual dedupe-window, fresh insert, explicit meetingId):
//   return { id, ownerId } using the already-known ownerId (unchanged shape, just widened return type).
```

```typescript
// packages/shared/src/repositories/MeetingAccessGrantRepository.ts
export class MeetingAccessGrantRepository {
  // ...existing methods unchanged...

  /** "Does any row exist at all" — deliberately ignores revokedAt/expiresAt (idempotency, not liveness). */
  static async existsForMeetingAndGrantee(meetingId: string, granteeUserId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: meetingAccessGrants.id })
      .from(meetingAccessGrants)
      .where(
        and(
          eq(meetingAccessGrants.meetingId, meetingId),
          eq(meetingAccessGrants.granteeUserId, granteeUserId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
```

```typescript
// apps/worker/src/services/autoJoinService.ts — appended after the existing queueMeetingRun call
const { id: meetingId, ownerId: resolvedOwnerId } = await queueMeetingRun({ /* ...unchanged params... */ });
enqueued += 1;

for (const rawEmail of event.participantEmails ?? []) {
  const email = rawEmail.trim().toLowerCase();
  if (!email) continue;

  const user = await UserRepository.findByEmail(email);
  if (!user || user.id === resolvedOwnerId) continue;

  const alreadyGranted = await MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, user.id);
  if (alreadyGranted) continue;

  await MeetingAccessGrantRepository.create({
    id: randomUUID(),
    meetingId,
    ownerId: resolvedOwnerId,
    granteeUserId: user.id,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
```

```typescript
// packages/shared/src/domain/meetingStatus.ts — diffs only
export type MeetingStatus =
  | "pending" | "joining" | "waiting_admission" | "recording" | "transcribing" | "summarizing"
  | "completed" | "admission_timeout" | "rejected" | "error"
  | "transcription_error"; // NEW

const ALLOWED_TRANSITIONS: Record<MeetingStatus, ReadonlyArray<MeetingStatus>> = {
  // ...existing entries unchanged...
  transcription_error: ["transcribing", "summarizing", "completed"], // NEW — recoverable, not terminal
};

// ACTIVE_PROCESSING_STATUSES: UNCHANGED — transcription_error is deliberately excluded.

const MEETING_STATUS_LABELS_ES: Record<MeetingStatus, string> = {
  // ...existing entries unchanged...
  transcription_error: "Error de transcripción", // NEW
};
```

```typescript
// apps/web/src/components/MeetingDetailsView.tsx — exact diffs
// ~116
const canReprocess =
  (meeting.status === "completed" || meeting.status === "transcription_error") &&
  meeting.recordingFilePath &&
  (!meeting.rawTranscription || !meeting.summary);

// ~118-133
const handleReprocess = async () => {
  const priorStatus = meeting.status; // NEW — captured before the optimistic set below
  setIsReprocessing(true);
  setMeeting((m) => ({ ...m, status: "transcribing" }));
  try {
    const result = await reprocessMeetingAction(meeting.id);
    if (!result.success) {
      alert("Error al reprocesar: " + result.error);
      setMeeting((m) => ({ ...m, status: priorStatus })); // was hardcoded "completed"
    }
  } catch (err) {
    console.error(err);
    setMeeting((m) => ({ ...m, status: priorStatus })); // was hardcoded "completed"
  } finally {
    setIsReprocessing(false);
  }
};

// ~656 (MP4 download)
{meeting.recordingFilePath && ( /* was: meeting.status === "completed" && meeting.recordingFilePath */
  <a href={meeting.recordingFilePath} ...>MP4</a>
)}

// ~703 (video player)
{meeting.recordingFilePath && ( /* was: meeting.status === "completed" && meeting.recordingFilePath */
  <Card className="overflow-hidden"> ... </Card>
)}

// ~641 retry-rejected/error button — UNCHANGED, condition already excludes transcription_error
// (meeting.status === "rejected" || meeting.status === "error") stays exactly as-is.
```

```typescript
// apps/web/src/components/DashboardClient.tsx — exact diffs
function getStatusVariant(status: MeetingStatus) {
  switch (status) {
    case "completed": return "success";
    case "error": return "destructive";
    case "rejected": return "destructive";
    case "transcription_error": return "warning"; // NEW
    case "recording":
    case "transcribing":
    case "summarizing": return "warning";
    default: return "secondary";
  }
}

// filter predicate (~85-89), "error" tab folds transcription_error in:
(statusFilter === "error" && (m.status === "error" || m.status === "transcription_error")) ||
```

## Esquema (Drizzle)

```typescript
export const meetingStatusEnum = pgEnum("meeting_status", [
  "pending", "joining", "waiting_admission", "recording", "transcribing", "summarizing",
  "completed", "admission_timeout", "error", "transcription_error", "rejected",
]);

export const meetings = pgTable("meetings", {
  // ...existing columns unchanged...
}, (table) => [
  index("meetings_source_event_unique_idx")
    .on(table.sourceProvider, table.sourceEventId)
    .where(sql`${table.sourceEventId} IS NOT NULL`), // drizzle-kit emits this as a partial UNIQUE index
]).enableRLS();
```

Nota: la forma de callback-array de `pgTable` es cómo este schema ya expresa los builders de
índice/constraint por tabla (único + parcial). Si el DDL generado por drizzle-kit para un índice *único*
parcial difiere de un `CREATE UNIQUE INDEX ... WHERE ...` escrito a mano, el SQL escrito a mano en `0007`
es la fuente de verdad — `schema.ts` solo necesita describir la misma restricción para que futuros diffs de
`drizzle-kit generate` no la vuelvan a proponer.

### SQL de migración

```sql
-- drizzle/0007_meeting_dedup_index.sql
CREATE UNIQUE INDEX "meetings_source_event_unique_idx" ON "meetings" ("source_provider", "source_event_id")
WHERE "source_event_id" IS NOT NULL;
```

```sql
-- drizzle/0008_transcription_error_status.sql
ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'transcription_error';
```

## Estrategia de testing (TDD — se requiere test RED para cada ítem de lógica abajo; UI/multimedia exenta según AGENTS.md)

| Capa | Qué testear | Ubicación del test RED | Requisito de DB |
|---|---|---|---|
| Condición de carrera de deduplicación en `queueMeetingRun` | Dos llamadas concurrentes para el mismo `(sourceProvider, sourceEventId)` insertan exactamente una fila; el perdedor devuelve el `{ id, ownerId }` del ganador | Extender `apps/__tests__/shared/services/meeting-queue-service.test.ts` — bloque NUEVO `describe.skipIf(!dbAvailable)` usando `createLiveConnection` (refleja a `meeting-access-grant-repository.test.ts`) | **Postgres en vivo** — un `MeetingRepository` mockeado no puede ejercitar una condición de carrera real sobre un índice único; este es exactamente el escenario que señala la spec |
| Reuniones encoladas manualmente exentas del índice | Dos inserts con `sourceEventId` nulo persisten ambos | El mismo bloque nuevo de live-DB | Postgres en vivo |
| Ruta de conflicto → re-consulta de `insertDedupedBySourceEvent` | Dada una fila preexistente, volver a llamarlo devuelve esa fila sin un segundo insert | El mismo bloque nuevo de live-DB (un solo escenario cubre tanto el método de repositorio como el servicio) | Postgres en vivo |
| Ramas no-source-event de `queueMeetingRun` sin afectar | Los 3 tests mockeados existentes siguen pasando con el tipo de retorno `{ id, ownerId }` ensanchado | `apps/__tests__/shared/services/meeting-queue-service.test.ts` (`describe` mockeado existente) — extender las aserciones para también verificar `result.ownerId` | Mockeado (patrón sin cambios) |
| Idempotencia de `existsForMeetingAndGrantee` | Sin fila → `false`; cualquier fila (incluso con `revokedAt` seteado) → `true` | Extender `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` — casos de test NUEVOS en el bloque `describe.skipIf(!dbAvailable)` existente | **Postgres en vivo** — misma justificación que el test de deduplicación: el propósito entero de este método es "¿existe una fila sin importar el estado?", mejor probado contra una tabla real, no un mock que trivialmente devuelve lo que se le indica |
| Creación de grant de co-asistente en `autoJoinService` | Un asistente registrado que no es owner recibe un grant; el asistente no registrado y el Owner se omiten; un poll repetido no duplica; un grant revocado no se resucita | Extender `apps/__tests__/worker/shared/auto-join-service.test.ts` — mockear `UserRepository`, `MeetingAccessGrantRepository` y `queueMeetingRun` (ahora devolviendo `{ id, ownerId }`) | Mockeado (coincide con el patrón existente de este archivo; la semántica de idempotencia en sí ya está probada en la capa de repositorio arriba, no se re-deriva acá) |
| Unión/transiciones/label/active-set de `meetingStatus` | `transcription_error` es recuperable (`canTransitionStatus("transcription_error", "completed")` es `true`); NO está en `ACTIVE_PROCESSING_STATUSES`; el label es `"Error de transcripción"` | Extender `apps/__tests__/web/shared/meeting-status.test.ts` (el archivo real existente — NO la ruta `shared/domain/...` implicada por spec.md, que no existe en este repo) | N/A (función pura) |
| Catch de fase de IA en `meetingWorkerService` | Dado que el upload tuvo éxito, la fase de IA lanza excepción → status `transcription_error`, no `error`; un fallo de unión/grabación (catch externo) sigue produciendo `error` | Extender `apps/__tests__/worker/services/meeting-worker-service.test.ts` | Mockeado (coincide con el patrón existente de este archivo) |
| Exenta (UI/multimedia, según AGENTS.md) | Condiciones de gating de `MeetingDetailsView.tsx`, variante de badge/filtro de `DashboardClient.tsx` — no existe archivo de test para ninguno de los dos componentes hoy; agregar uno está fuera de alcance para este cambio de corrección de bugs (gap preexistente, no introducido acá) | Solo validación manual/de integración |

Dos tests **requieren el patrón live-DB** (`createLiveConnection` + `describe.skipIf(!dbAvailable)`), no un
módulo mockeado, según el precedente ya establecido de este repo y la trampa de `mock.module()` de Bun de
"gana el primer registro" que ya rompió CI una vez en esta sesión:

1. El test de condición de carrera de deduplicación en `queueMeetingRun` (`meeting-queue-service.test.ts`)
   — un conflicto real de índice único no puede simularse con un mock que simplemente devuelve lo que el
   test le indica.
2. El nuevo test de idempotencia de `existsForMeetingAndGrantee` (`meeting-access-grant-repository.test.ts`)
   — misma razón; el contrato del método es enteramente sobre el estado real de las filas.

## Matriz de amenazas

N/A — este cambio no introduce routing, shell, subproceso, automatización de VCS/PR, clasificación de
archivos ejecutables, ni ningún límite de integración de procesos. La nueva escritura de auto-grant está
acotada estrechamente (ver No-objetivos en spec.md) y reutiliza la ruta de escritura de
`meeting_access_grants` existente de 009 y su postura de RLS.

## Migración / Rollout

Dos migraciones, `drizzle/0007_meeting_dedup_index.sql` y `drizzle/0008_transcription_error_status.sql`,
aplicadas en orden. Sin backfill: filas `meetings` duplicadas preexistentes para el mismo `(sourceProvider,
sourceEventId)` (si existieran en los datos actuales) harían que `0007` falle al crear el índice único —
según el precedente de la Nota de migración de este repo (009 también asumió un reset de DB junto con su
migración para datos de test), se espera que esto corra contra un dataset reseteado/limpio. Las filas
`error` preexistentes no se reclasifican retroactivamente a `transcription_error` (no-objetivo explícito en
spec.md).

## Pronóstico de carga de revisión

Según el precedente de 009 en este repo, el pronóstico de líneas cambiadas y la división en chained-PR (si
se cruza el umbral de 400 líneas) se lleva en `tasks.md`, no en `plan.md` — el `plan.md` de 009 no contiene
esa sección; el `tasks.md` de 009 sí. Este diseño deja deliberadamente ese pronóstico para la fase de
tasks, para mantener la misma convención. Una señal aproximada de alcance para el pronóstico de la fase de
tasks: tres áreas de problema testeables de forma independiente (deduplicación, auto-grant, recuperación de
transcripción), cada una tocando 2-4 archivos con diffs pequeños y mecánicos (sin componentes nuevos, sin
servicios nuevos) — probablemente bien por debajo del umbral de 400 líneas de chained-PR como un solo PR,
pero la fase de tasks debería confirmarlo contra los conteos de líneas reales una vez que los diffs estén
escritos.

## Preguntas abiertas

Ninguna. El único ítem abierto señalado por el agente que escribió la spec (división de archivos de
migración para el índice único parcial vs. el valor de enum aditivo) está resuelto arriba — dos archivos,
siguiendo el precedente de aislamiento de `0001`.
