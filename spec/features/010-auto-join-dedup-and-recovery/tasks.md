# Tareas: Deduplicación de Auto-Join, Acceso Compartido y Recuperación de Transcripción

## Pronóstico de carga de revisión

| Campo | Valor |
|-------|-------|
| Líneas cambiadas estimadas | ~370-430 (3 unidades de trabajo, ~120-240 cada una) — calculado a partir de los conteos de líneas actuales de los archivos + los diffs exactos de plan.md, no adivinado |
| Riesgo respecto del presupuesto de 400 líneas | Límite (Medio-Alto) — el total ronda el umbral; el Problema 2 (auto-grant) es el mayor contribuyente porque el patrón de mocking existente de `auto-join-service.test.ts` es verboso (cada test re-mockea 3 módulos + un fixture completo de evento de calendario, ~35-45 líneas por caso) |
| Chained PRs recomendados | Condicional — confirmar con `git diff --stat` por fase antes de abrir el PR; si el total real es ≤ ~380, entregar un solo PR desde la rama existente; si cruza ~400, dividir por número de problema (ver abajo) |
| División sugerida (si se dispara) | PR1 (deduplicación) → PR2 (auto-grant, necesita la forma de retorno `{id, ownerId}` de PR1) ; PR3 (recuperación de transcripción) es disjunta en archivos de PR1/PR2 salvo dos líneas aditivas en `schema.ts` — totalmente paralela, puede aterrizar primero, último, o standalone |
| Estrategia de entrega | ask-on-risk (por defecto, no se proporcionó ninguna) |
| Estrategia de cadena | No es una cadena profunda de feature-branches como 009 (aquello fueron ~2000 líneas a través de 7 unidades) — si se necesita división, alcanza con una división plana de 3 unidades secuencial/paralela a partir de la rama existente `fix/auto-join-dedup-shared-access-transcription-recovery`; solo la unidad 2 tiene una dependencia de código real sobre la unidad 1 |

Decisión necesaria antes de aplicar: Sí — medir el diff real después de que la Fase 1 y la Fase 2 estén
code-complete (`git diff --stat` contra `dev`) antes de decidir un solo PR vs. la división en 3. No asumir
ningún resultado; la estimación de arriba está lo suficientemente cerca de 400 como para caer de cualquier
lado, dependiendo de cuán verbosos terminen siendo los nuevos bloques de test live-DB y mockeados.

**Resuelto:** el diff real (`git diff --stat` desde el commit `9afca64` de spec/design/tasks hasta la punta
de este trabajo) es de **596 inserciones + 90 eliminaciones a través de 18 archivos de código/test (~686
líneas cambiadas)** — por encima del presupuesto de 400 líneas, impulsado sobre todo por las correcciones
obligatorias (un bloque de concurrencia nuevo en `meeting-access-grant-repository.test.ts`, un archivo
completamente nuevo `meeting-queue-service-live.test.ts`, y el test de aislamiento por-participante de
`auto-join-service.test.ts`) que no estaban en la estimación original. Dividido en 3 PRs apilados/paralelos
según esta división (PR1 deduplicación → PR2 auto-grant, PR3 recuperación de transcripción independiente)
para mantenerse dentro de fragmentos revisables a pesar de que el total cruza las 400 líneas.

### Unidades de trabajo sugeridas

| Unidad | Objetivo | PR probable | Comando de test enfocado | Harness de runtime | Límite de rollback |
|---|---|---|---|---|---|
| 1 | Deduplicación: índice único parcial + `MeetingRepository.insertDedupedBySourceEvent` + ensanchamiento del tipo de retorno de `queueMeetingRun` a `{ id, ownerId }` | PR1 (base) | `bun test apps/__tests__/shared/services/meeting-queue-service.test.ts` | `bun run infra:reset` (DB limpia, aplica `0007`) — el test de concurrencia live-DB ejercita la condición de carrera real del índice único | Revertir la adición del índice en `schema.ts`, `drizzle/0007_meeting_dedup_index.sql`, `MeetingRepository.ts`, `meetingQueueService.ts` |
| 2 | Auto-grant: `MeetingAccessGrantRepository.existsForMeetingAndGrantee` + loop de co-asistentes de `autoJoinService` (ADR-0007) | PR2 (necesita la forma de retorno ensanchada de PR1) | `bun test apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts apps/__tests__/worker/shared/auto-join-service.test.ts` | `bun run infra:up` (test de idempotencia live-DB); poll manual de `bun run dev:worker` con dos asistentes registrados en un mismo evento de calendario | Revertir `MeetingAccessGrantRepository.ts`, `autoJoinService.ts` |
| 3 | Recuperación de transcripción: enum `transcription_error` + transiciones de dominio + división del bloque catch del worker + gating/badge web | PR3 (independiente — disjunta en archivos salvo dos líneas aditivas en `schema.ts`; puede correr en paralelo a PR1/PR2) | `bun test apps/__tests__/web/shared/meeting-status.test.ts apps/__tests__/worker/services/meeting-worker-service.test.ts` | `bun run infra:reset` (aplica `0008`); walkthrough manual de `bun run dev:web` (el video se muestra en `transcription_error`, aparece el botón de reprocesar y no el reintento destructivo, el badge del dashboard es `warning`) | Revertir el valor de enum en `schema.ts`, `drizzle/0008_transcription_error_status.sql`, `meetingStatus.ts`, `meetingWorkerService.ts`, `MeetingDetailsView.tsx`, `DashboardClient.tsx` |

La Unidad 3 no tiene cambios de UI cubiertos por tests (`MeetingDetailsView.tsx`, `DashboardClient.tsx`) —
no existen archivos de test para ninguno de los dos componentes hoy, y agregarlos está fuera de alcance
según la excepción visual/manual-testing de AGENTS.md; la verificación ahí es solo el walkthrough manual.

---

## Fase 1: Deduplicación — Encolado atómico (Problema 1)

Spec: "Problema 1 — Deduplicación atómica de encolados de auto-join" (`spec.md`). Diseño: el contrato
`insertDedupedBySourceEvent` de plan.md y la fila de Decisiones de arquitectura "Punto de aplicación de la
deduplicación".

- [x] 1.1 `packages/shared/src/db/schema.ts`: agregar `import { sql } from "drizzle-orm";` (no importado
      actualmente — hoy solo se importan símbolos de `drizzle-orm/pg-core`); convertir la tabla `meetings`
      de su forma actual de 2 argumentos `pgTable(name, columns).enableRLS()` a la forma de 3 argumentos
      con callback-array para que pueda llevar el índice único parcial —
      `pgTable("meetings", { ...columnas sin cambios... }, (table) => [index("meetings_source_event_unique_idx").on(table.sourceProvider, table.sourceEventId).where(sql\`${table.sourceEventId} IS NOT NULL\`)]).enableRLS()`.
      `index` ya está importado. **Desviación:** se usó `uniqueIndex` (no `index`) — el builder `index()`
      de drizzle-orm siempre setea `unique: false`; solo `uniqueIndex()` emite `CREATE UNIQUE INDEX`. Usar
      `index()` plano tal como la tarea lo describe literalmente produciría silenciosamente un índice no
      único y anularía por completo el Problema 1. Se agregó `uniqueIndex` al import de
      `drizzle-orm/pg-core`.
- [x] 1.2 `drizzle/0007_meeting_dedup_index.sql` (archivo nuevo, siguiente después de `0006`): escrito a
      mano `CREATE UNIQUE INDEX "meetings_source_event_unique_idx" ON "meetings" ("source_provider",
      "source_event_id") WHERE "source_event_id" IS NOT NULL;` — este archivo es la fuente de verdad si el
      DDL generado por drizzle-kit para un índice único parcial alguna vez diverge de lo que describe 1.1
      (nota explícita de plan.md). **Extendido según corrección obligatoria #2:** se antepuso un paso de
      pre-deduplicación `DELETE ... USING` (mantiene la fila más antigua por par `(source_provider,
      source_event_id)` según `(created_at, id)`, elimina el resto) para que esta migración no falle
      contra datos de producción que ya tengan los duplicados que esta feature corrige.
- [x] 1.3 RED+GREEN: `packages/shared/src/repositories/MeetingRepository.ts` — nuevo
      `insertDedupedBySourceEvent(values: MeetingInsert): Promise<MeetingRecord>` (agregar `isNotNull` al
      import existente de `drizzle-orm` junto a `and, eq, gte, inArray`);
      `.insert(meetings).values(values).onConflictDoNothing({ target: [meetings.sourceProvider,
      meetings.sourceEventId], where: isNotNull(meetings.sourceEventId) }).returning()`; si no hay fila,
      re-consultar vía el `findBySourceEvent` existente y lanzar excepción si sigue sin encontrarse
      (conflicto-reportado-pero-ausente es un bug real, no un estado válido). `claimNextPending`/`for
      update skip locked` queda intacto — esto corrige solo la duplicación en tiempo de encolado.
- [x] 1.4 RED+GREEN: `packages/shared/src/services/meetingQueueService.ts` — ensanchar el tipo de retorno
      de `queueMeetingRun` a `Promise<{ id: string; ownerId: string }>`; la rama de source-event
      (`sourceProvider && sourceEventId && !meetingId`) reemplaza su verificación `findBySourceEvent` + la
      llamada `insert` posterior por una única llamada a `MeetingRepository.insertDedupedBySourceEvent(...)`,
      devolviendo `{ id: record.id, ownerId: record.ownerId }`; los otros 3 puntos de retorno (`meetingId`
      explícito, hit de la ventana de deduplicación manual, insert manual nuevo) agregan cada uno
      `ownerId` a su objeto de retorno existente usando el param/fila de `ownerId` ya conocido — no se
      necesitan lookups nuevos ahí.
- [x] 1.5 Extender `apps/__tests__/shared/services/meeting-queue-service.test.ts`:
  - `describe("queueMeetingRun — mandatory ownerId (009 Phase 2)")` mockeado existente: agregar
    aserciones `expect(result.ownerId).toBe(...)` a los 3 tests existentes (su mock de `MeetingRepository`
    ya no tiene `insertDedupedBySourceEvent`, lo cual es correcto — ninguno de estos tests setea
    `sourceProvider`/`sourceEventId`, así que nunca tocan esa rama).
  - Bloque NUEVO `describe.skipIf(!dbAvailable)` usando `createLiveConnection` + `describe.skipIf`
    (reflejando tal cual el harness de `meeting-access-grant-repository.test.ts` — sonda `canConnect`,
    `afterAll(() => pool.end())`, limpieza de filas por test): (a) dos llamadas concurrentes a
    `queueMeetingRun` para el mismo `(sourceProvider, sourceEventId)` insertan exactamente una fila y el
    perdedor devuelve el `{ id, ownerId }` del ganador; (b) dos reuniones encoladas manualmente con
    `sourceEventId` nulo persisten ambas; (c) volver a llamar a
    `insertDedupedBySourceEvent`/`queueMeetingRun` contra una fila preexistente devuelve esa fila sin un
    segundo insert. **Desviación:** se ubicó en un archivo NUEVO separado, `meeting-queue-service-live.test.ts`,
    en vez del mismo archivo — se descubrió empíricamente que `mock.module()` de Bun sobre
    `@meeting-bot/shared/repositories/MeetingRepository` (usado por los tests mockeados existentes en el
    mismo archivo) secuestra ese specifier a nivel de proceso incluso para el import pre-mock de
    `queueMeetingRun` del bloque live, y `mock.restore()` no deshace esto para un consumidor ya cargado.
    Verificado mediante una corrida RED/GREEN basada en stash: la corrida RED genuinamente compitió contra
    un Postgres real (probando que la DB en vivo era alcanzable), la corrida GREEN (mismo archivo) falló
    con `insertDedupedBySourceEvent is not a function`; una vez dividido en su propio archivo, pasó. Esto
    refleja el precedente ya existente en el repo de mantener los tests live-DB aislados por archivo de
    cualquier test mockeado que toque el mismo specifier.
- [x] 1.6 `bun run infra:reset` contra una DB local limpia, confirmar que `0007` aplica sin problemas
      (ninguna fila duplicada preexistente de `(source_provider, source_event_id)` bloquea la creación del
      índice), y luego correr en verde el bloque live-DB de 1.5. Verificado: el contenedor `meeting-db` en
      ejecución ya tenía `meetings_source_event_unique_idx` aplicado vía `drizzle-kit push` (el mecanismo
      real de sincronización local de schema de este repo — ningún runner ejecuta `drizzle/*.sql`
      secuencialmente); la sentencia `DELETE ... USING` de pre-deduplicación escrita a mano se corrió
      adicionalmente en modo dry-run (`BEGIN; ...; ROLLBACK;`) directamente contra la tabla en vivo para
      confirmar que es Postgres sintácticamente válido (0 filas afectadas, no hay duplicados presentes).
      El bloque live-DB (3 tests) pasa en verde.

## Fase 2: Auto-Join Co-Attendee Grant (Problema 2 — excepción ADR-0007)

Spec: "Problema 2 — Auto-Join Co-Attendee Grant (excepción ADR-0007)" (`spec.md`). Dominio:
`docs/adr/0007-auto-join-co-attendee-automatic-access-grant.md`, la entrada "Auto-Join Co-Attendee Grant"
de `docs/CONTEXT.md`. Depende de la Fase 1 (la forma `{ id, ownerId }` de `queueMeetingRun`).

- [x] 2.1 RED+GREEN: `packages/shared/src/repositories/MeetingAccessGrantRepository.ts` — nuevo
      `existsForMeetingAndGrantee(meetingId: string, granteeUserId: string): Promise<boolean>` — "¿existe
      alguna fila en absoluto?" (ignora deliberadamente `revokedAt`/`expiresAt`, distinto del
      `findLiveGrant` existente). Extender el bloque CRUD `describe.skipIf(!dbAvailable)` existente de
      `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` con dos casos nuevos:
      sin fila para el par → `false`; una fila que existe con `revokedAt` seteado → sigue siendo `true`
      (el contrato de idempotencia según la spec: un grant revocado manualmente nunca debe recrearse
      silenciosamente). **Corrección obligatoria #4 (2do bullet):** se agregó un comentario de
      documentación distinguiendo `existsForMeetingAndGrantee` (matchea CUALQUIER fila) de `findLiveGrant`
      (solo filas actualmente activas).
- [x] 2.1a **Corrección obligatoria #1 (CRÍTICA):** `packages/shared/src/db/schema.ts` — se convirtió
      `meetingAccessGrants` a la forma de `pgTable` de 3 argumentos con callback-array, agregando un
      `uniqueIndex` incondicional (no parcial) sobre `(meetingId, granteeUserId)` — coincide con la
      semántica "cualquier fila cuenta" de `existsForMeetingAndGrantee`. Migración nueva
      `drizzle/0009_meeting_access_grant_unique_pair.sql`. Nuevo
      `MeetingAccessGrantRepository.createDedupedForMeetingAndGrantee` (`ON CONFLICT (meeting_id,
      grantee_user_id) DO NOTHING` + re-consulta en caso de conflicto, reflejando a
      `insertDedupedBySourceEvent`). Test de concurrencia nuevo contra Postgres en vivo en
      `meeting-access-grant-repository.test.ts`: dos llamadas concurrentes a
      `createDedupedForMeetingAndGrantee` para el mismo par insertan exactamente una fila.
- [x] 2.2 RED+GREEN: `apps/worker/src/services/autoJoinService.ts` — después de que `const { id: meetingId,
      ownerId: resolvedOwnerId } = await queueMeetingRun(...)` resuelve (cualquiera de las dos ramas —
      insert-nuevo o hit-de-deduplicación), recorrer `event.participantEmails ?? []`: hacer trim/lowercase
      de cada email, omitir vacíos; `UserRepository.findByEmail(email)`; omitir si no hay match o
      `user.id === resolvedOwnerId`; `MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId,
      user.id)` — omitir si es `true` (solo fast-path); de lo contrario,
      `MeetingAccessGrantRepository.createDedupedForMeetingAndGrantee({ id: randomUUID(), meetingId,
      ownerId: resolvedOwnerId, granteeUserId: user.id, expiresAt: null, revokedAt: null, createdAt,
      updatedAt })` (la restricción de DB es la fuente de verdad real — corrección obligatoria #1). Imports
      nuevos necesarios: `randomUUID` de `crypto`, `UserRepository`, `MeetingAccessGrantRepository`.
      Acotado solo a esta función — `EnqueueMeetingCommand.ts` y la chat tool `enqueue_meeting` (rutas
      manuales) no se tocan. **Corrección obligatoria #3:** el cuerpo por-participante (find/exists/create)
      está envuelto en su propio try/catch que hace `console.warn` y continúa con el siguiente
      participante, así que el fallo de un participante nunca aborta el resto del batch. **Corrección
      obligatoria #4 (1er bullet):** se agregó un comentario ADR-0007 en el sitio de la llamada de creación
      del grant explicando por qué esta ruta otorga automáticamente, a diferencia del resto del codebase.
- [x] 2.3 Extender `apps/__tests__/worker/shared/auto-join-service.test.ts` (actualizar los mocks de
      `queueMeetingRun` de los 3 tests existentes para que devuelvan `{ id, ownerId }` en vez de `void`, y
      agregar mocks de módulo de `UserRepository`/`MeetingAccessGrantRepository` donde los tests nuevos los
      necesiten) con casos nuevos: un asistente registrado que no es owner recibe un grant con `expiresAt`
      nulo; el propio email del Owner resuelto y un email de asistente no registrado se omiten ambos (sin
      llamada a grant para ninguno de los dos); un poll repetido del mismo evento (mockeando
      `existsForMeetingAndGrantee` → `true`) no vuelve a llamar a `create`; un grant deliberadamente
      revocado (`existsForMeetingAndGrantee` → `true` aunque el estado subyacente del mock tenga
      `revokedAt` seteado) no se resucita — este último caso solo necesita probar que el servicio confía en
      el booleano del repositorio, dado que la semántica de "ignora revokedAt" en sí ya está probada en la
      capa de repositorio en 2.1, no se re-deriva acá. **Más el test de la corrección obligatoria #3:** que
      el `UserRepository.findByEmail` de un participante lance una excepción no aborta el resto del batch —
      al otro participante igual se le otorga el grant y se registra una advertencia.
- [x] 2.4 Verificar (grep/codegraph, sin cambio de código) que solo `autoJoinService.ts` ganó el loop de
      creación de grant — `EnqueueMeetingCommand.ts`, `app/actions/bot.ts`,
      `api/v1/extension/bot/start/route.ts`, y la chat tool `enqueue_meeting` siguen siendo solo-sugerencia
      según el modelo de 009 (No-objetivo explícito en spec.md). Confirmado vía grep: solo 6 archivos
      referencian `queueMeetingRun` en todo el repo (el servicio en sí, sus dos archivos de test,
      `autoJoinService.ts`, y `EnqueueMeetingCommand.ts`); el tipo de retorno `Promise<{ id: string }>` de
      `EnqueueMeetingCommand.execute()` sigue tipando correctamente contra la forma ensanchada `{ id,
      ownerId }` (subtipado estructural) — confirmado vía typecheck de `apps/web`.

## Fase 3: Recuperación de transcripción (Problema 3)

Spec: "Problema 3 — El fallo de transcripción es un estado recuperable, el video permanece visible"
(`spec.md`). Dominio: la entrada `Meeting Status` de `docs/CONTEXT.md` ("no todo estado de fallo es
terminal... `transcription_error` es recuperable"). Independiente de las Fases 1-2 (disjunta en archivos
salvo dos líneas aditivas en `schema.ts`).

- [x] 3.1 `packages/shared/src/db/schema.ts`: agregar `"transcription_error"` al array `meetingStatusEnum`
      (adyacente a `"error"`, el orden es irrelevante para los enums de Postgres).
- [x] 3.2 `drizzle/0008_transcription_error_status.sql` (archivo nuevo, aislado — NO debe combinarse con
      `0007` en la misma transacción/archivo según la restricción de Postgres `ALTER TYPE ... ADD VALUE`
      de plan.md): sentencia única `ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS
      'transcription_error';` — refleja exactamente la forma de `drizzle/0001_add_rejected_status.sql`.
- [x] 3.3 RED+GREEN: `packages/shared/src/domain/meetingStatus.ts` — agregar `"transcription_error"` a la
      unión `MeetingStatus`; agregar `transcription_error: ["transcribing", "summarizing", "completed"]` a
      `ALLOWED_TRANSITIONS` (recuperable, a diferencia del `[]`/`["pending"]` de `error`/`rejected`);
      agregar `transcription_error: "Error de transcripción"` a `MEETING_STATUS_LABELS_ES`. NO agregarlo a
      `ACTIVE_PROCESSING_STATUSES`. Extender `apps/__tests__/web/shared/meeting-status.test.ts` (el
      archivo real existente — plan.md corrigió esta ruta respecto de la suposición original de spec.md de
      una ubicación inexistente `shared/domain/...`): agregar `"transcription_error"` al array `STATUSES`
      y `"Error de transcripción"` al array de labels esperados; test(s) nuevo(s) que aseveren que
      `canTransitionStatus("transcription_error", "completed")` (y `"transcribing"`/`"summarizing"`) es
      `true`, y que `ACTIVE_PROCESSING_STATUSES` no incluye `"transcription_error"`.
- [x] 3.4 RED+GREEN: `apps/worker/src/services/meetingWorkerService.ts` — el bloque `catch` interno de la
      fase de IA (el que envuelve `transcribeRecording`/`summarize`, que actualmente setea `status:
      "error"`) cambia a `status: "transcription_error"`; el `catch` externo (fallos de unión/grabación,
      nunca se produjo ningún video) se mantiene en `"error"`, sin cambios. Actualizar el test existente de
      `apps/__tests__/worker/services/meeting-worker-service.test.ts` "keeps the uploaded recording and
      does not rejoin when transcription fails after upload" — su aserción
      `expect(harness.meeting.status).toBe("error")` es el test RED: cambiarla primero a
      `.toBe("transcription_error")` (falla contra el código actual), y luego hacer el cambio de código de
      3.4 para ponerla en GREEN. El test hermano "still retries when the bot fails before any recording
      exists" (ruta del catch externo) sigue afirmando `"error"` sin cambios — confirma que los dos bloques
      catch permanecen distintos.
- [x] 3.5 `apps/web/src/components/MeetingDetailsView.tsx`: el gate del reproductor de video (~línea 703) y
      el gate del link de descarga MP4 (~línea 656) cambian de `meeting.status === "completed" &&
      meeting.recordingFilePath` a solo `meeting.recordingFilePath` truthy; `canReprocess` (~línea 116)
      pasa a ser `(meeting.status === "completed" || meeting.status === "transcription_error") &&
      meeting.recordingFilePath && (!meeting.rawTranscription || !meeting.summary)`; `handleReprocess`
      (~líneas 118-133) captura `const priorStatus = meeting.status;` antes del `setMeeting((m) => ({ ...m,
      status: "transcribing" }))` optimista, y tanto la rama `!result.success` como el bloque `catch`
      restauran `priorStatus` en vez del `"completed"` hardcodeado. El botón de reintento destructivo de
      reunión completa (`status === "rejected" || status === "error"`, ~línea 641) se deja exactamente
      igual — su condición ya excluye `transcription_error`. Sin archivo de test nuevo (gap preexistente,
      excepción visual de AGENTS.md).
- [x] 3.6 `apps/web/src/components/DashboardClient.tsx`: `getStatusVariant` (~líneas 40-50) gana `case
      "transcription_error": return "warning";` (distinto del `"destructive"` de `"error"`); la cláusula de
      la pestaña `"error"` del predicado de filtro (~línea 88) pasa a ser `(statusFilter === "error" &&
      (m.status === "error" || m.status === "transcription_error"))` — sin pestaña de filtro nueva. Sin
      archivo de test nuevo (misma exención que 3.5).

## Fase 4: Verificación

- [x] 4.1 `bun test apps/__tests__` en verde, incluyendo los bloques live-DB nuevos (requiere `bun run
      infra:up` de antemano; usan `describe.skipIf(!dbAvailable)` así que CI sin una DB sigue pasando en
      verde, solo que se omiten). Verificado: 313 pass / 0 fail a través de 54 archivos con `DATABASE_URL`
      apuntando al contenedor `meeting-db` en ejecución. Confirmado que los bloques live-DB realmente se
      ejecutaron (no se omitieron): se re-corrieron los 3 archivos live-DB
      (`meeting-access-grant-repository.test.ts`, `user-repository.test.ts`,
      `meeting-queue-service-live.test.ts`) — 19 pass contra el contenedor real; se re-corrieron los mismos
      archivos con `DATABASE_URL` apuntando a un puerto inalcanzable — 22 skip, 0 pass, probando que
      `describe.skipIf(!dbAvailable)` realmente condiciona sobre una conexión en vivo en vez de correr
      siempre.
- [x] 4.2 `bun run lint && bun run typecheck && bun run build:web`. Los tres en verde: lint 0 errores (1
      warning preexistente y no relacionado en `apps/extension/src/content/content.ts`); typecheck limpio
      a través de los 4 workspaces; el build de producción de `build:web` compiló exitosamente.
- [ ] 4.3 Walkthrough manual: (a) disparar dos polls de auto-join casi simultáneos para el mismo evento de
      calendario (o forzarlo vía el endpoint `/internal/auto-join/poll` dos veces seguidas) y confirmar
      exactamente una fila de `meetings` y una unión del bot, no dos; (b) un evento de calendario con dos
      asistentes registrados — confirmar que el asistente que no es owner puede listar/abrir la reunión
      sin que el Owner haga nada, y que revocar su grant y luego volver a hacer poll no lo resucita; (c)
      forzar un fallo de procesamiento de IA después de una grabación exitosa (por ejemplo, romper la
      config del proveedor de transcripción) y confirmar que la reunión muestra `transcription_error`, que
      el video/descarga están visibles, que el badge del dashboard es `warning` bajo "Con Error", y que el
      botón ofrecido es el de reprocesar (no el de reunión completa destructiva). **Fuera de alcance para
      este agente** — requiere una sesión en vivo de navegador/Google Meet; queda para verificación manual
      humana.
