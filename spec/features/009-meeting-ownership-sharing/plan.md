# Diseño: Meeting Ownership & Personalized Sharing (+ Nomenclatura S3)

## Enfoque técnico

Se agrega un único choke point de ownership (`meetings.ownerId`, FK `NOT NULL` hacia `users.id`)
resuelto en la única función por la que ya pasa todo path de creación de reunión —
`queueMeetingRun()` — en lugar de parchar cada caller por separado. Cada path de lectura
(`WebMeetingRepository`, `createShareAction`) gana un filtro explícito de ownership/grant en lugar del
comportamiento actual sin filtro y sin chequeo de auth. Una nueva tabla `meeting_access_grants` (con la
misma forma que `meeting_shares`) cubre el sharing entre usuarios registrados; `meeting_shares` conserva
solo `restricted_email` — `"public"` se elimina recreando el enum, no con una migración de datos, porque
Postgres no puede eliminar un valor de enum en uso. La nomenclatura de S3 pasa a ser
leer-la-clave-persistida-primero, recalcular-como-fallback-después, de modo que el nuevo formato
`${provider}/${name}_${date}_${id}.mp4` nunca desincroniza los objetos ya subidos.

## Decisiones de arquitectura

| Decisión | Elección | Alternativas consideradas | Justificación |
|---|---|---|---|
| Punto de captura del Owner | Un único cambio en `queueMeetingRun()` (packages/shared/src/services/meetingQueueService.ts), nuevo parámetro obligatorio `ownerId: string` | Parchar cada uno de los 6 entry points por separado | Fix de causa raíz: todo entry point ya rutea a través de esta única función; un solo guard le gana a seis |
| Auth de la chat-tool | `getServerSession(authOptions)` llamado directamente dentro de `enqueueMeetingTool.execute` / `manageMeetingShareTool.execute` | Propagar un parámetro `context: { userId }` a través de `ToolDefinition.execute` → `executeTool` → `streamChatRuntime` → cada implementación de `ChatProvider.streamChat` | `api/chat/route.ts` ya ejecuta `getServerSession` dentro del mismo scope de request de Next.js; volver a llamarlo dentro de las dos tools que lo necesitan es un diff de 2 archivos, contra reestructurar toda la interfaz de tool-calling para tools que no lo necesitan |
| Owner machine-to-machine (`/api/bot/start`, `API_ROUTE_SECRET`) | Exigir `ownerEmail` en el body del request, resolver vía el nuevo `UserRepository.findByEmail`; 400 si falta o no se puede resolver | Dejar esta ruta sin Owner (viola el NOT NULL); derivar el owner de `organizerEmail` (el spec lo prohíbe explícitamente) | No existe sesión en esta ruta; una identidad explícita y resoluble es la única forma de cumplir "El Owner es obligatorio" sin inventar un ownership derivado del calendario. Se confirmó vía `apps/extension/src/background/api-client.ts` (`resolveTransport`) que esta ruta solo se usa en el modo de auth por legacy-token — el modo moderno de sesión enlazada reescribe hacia `/api/v1/extension/bot/start`, que ya tiene `userId` desde el payload del Extension Access Token y no necesita ningún cambio. `docs/extension.md` confirma que `/api/bot/start` es anterior al sistema de Extension Access Token (002/003/007) — es un fallback legacy, no una integración diseñada por separado |
| Resolución de owner en auto-join | Path primario (usuarios de calendario conectados por OAuth): propagar `ownerId` = el `users.id` con calendario habilitado bajo cuyas credenciales consultó el provider. Path de fallback acotado (cero usuarios OAuth, lista estática de env `AUTO_JOIN_ORGANIZER_EMAILS`): saltear el encolado, loguear un warning | Fabricar un owner sintético/de servicio para el fallback que solo depende de la env var | El fallback de la lista de env no tiene ninguna fila de `users` a la que atribuir — inventar datos de ownership es peor que un skip logueado (no destructivo; la reunión simplemente no hace auto-join), y no hay evidencia de que se dependa de este path de config acotado en producción |
| Eliminación de `"public"` del enum | Recrear el enum `share_type` sin `"public"`; reetiquetar las filas `"public"` revocadas a `"restricted_email"` antes del swap de tipo | Backfillear/borrar filas; dejar el enum como está y simplemente dejar de emitir `"public"` en el código | Postgres no tiene `ALTER TYPE ... DROP VALUE`; las filas ya tienen `revokedAt` seteado, así que reetiquetar es inerte (`resolvePublicShare` chequea `revokedAt` antes de ramificar por `shareType`) |
| TTL del grant | Reusar `DEFAULT_SHARE_TTL_OPTIONS_MINUTES` tal cual, extraído a un módulo compartido | Nueva constante de TTL para grants | El spec exige el mismo menú; la extracción evita duplicar el array en dos servicios |
| Almacenamiento de Participant | `meetings.participantEmails: jsonb` (array de strings), sin tabla nueva | Tabla completa `meeting_participants` | YAGNI — el Owner revisa/otorga de a uno, no se necesita estado por participant (status, timestamps) |
| Atribución del owner de calendario | `CalendarMeetingEvent` gana `ownerUserId: string`; `GoogleCalendarProvider` ya itera por usuario OAuth, solo necesita estamparlo | Resolver el owner más tarde a partir de `organizerEmail` | El spec prohíbe derivarlo de `organizerEmail`; el loop por usuario OAuth ya sabe exactamente de qué usuario registrado vino este evento |

## Flujo de datos

    Extension INVITE_BOT ──┐
    Dashboard "queue" ──────┼──→ resolve ownerId (session/token/email) ──→ queueMeetingRun(ownerId, ...)
    Chat enqueue_meeting ───┤                                                        │
    Calendar auto-join ─────┘                                                        ▼
                                                                          MeetingRepository.insert
                                                                          (ownerId NOT NULL)

    listRecent(userId) ──→ WHERE ownerId = :userId
                              OR EXISTS(live grant for :userId)
                              AND owner.authorized_accounts.isActive
                         ──→ MeetingRecord[]

    Owner opens sharing ──→ Participant suggestions (event.attendees, calendar-sourced only)
                         ──→ createGrantAction (registered user) | createShareAction (restricted_email)
                         ──→ both require session.user.id === meeting.ownerId

    Upload completes ──→ buildAndPersistRecordingStorageKey(meeting) ──→ meetings.recordingStorageKey
    Delete/sign/download ──→ recordingStorageKey ?? buildRecordingStorageKey() (legacy fallback)

## Cambios de archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/shared/src/db/schema.ts` | Modificar | `meetings.ownerId` (FK NOT NULL a `users.id`), `meetings.recordingStorageKey` (text nullable), `meetings.participantEmails` (jsonb string[] nullable); `shareTypeEnum` elimina `"public"`; nueva tabla `meetingAccessGrants` |
| `drizzle/0006_meeting_ownership_and_sharing.sql` | Crear | Migración escrita a mano: agrega columnas, crea `meeting_access_grants`, revoca y reetiqueta las filas `"public"`, recrea el enum `share_type` |
| `packages/shared/src/repositories/UserRepository.ts` | Crear | `findByEmail(email): Promise<{id, email} \| null>` — necesario para la resolución de owner machine-to-machine |
| `packages/shared/src/repositories/MeetingRepository.ts` | Modificar | `MeetingInsert` ahora exige `ownerId`; sin cambios de firma de métodos (los tipos fluyen desde el schema) |
| `packages/shared/src/repositories/MeetingAccessGrantRepository.ts` | Crear | CRUD que espeja a `MeetingShareRepository`: `create`, `findById`, `listByMeetingId`, `findLiveGrant(meetingId, granteeUserId)`, `revokeById` |
| `packages/shared/src/services/meetingQueueService.ts` | Modificar | `StartMeetingParams` gana `ownerId: string` obligatorio y `participantEmails?: string[]` opcional; ambos se pasan a `MeetingRepository.insert` |
| `apps/web/src/commands/meeting/EnqueueMeetingCommand.ts` | Modificar | `EnqueueMeetingInput` gana `ownerId: string` obligatorio |
| `apps/web/src/services/meetingService.ts` | Modificar | `enqueueMeeting(input)` — `input.ownerId` obligatorio, solo passthrough |
| `apps/web/src/app/actions/bot.ts` | Modificar | `startBotAction` resuelve `getServerSession(authOptions)`, devuelve 401 si no hay `session.user.id`, lo pasa como `ownerId` |
| `apps/web/src/app/api/v1/extension/bot/start/route.ts` | Modificar | `ownerId = auth.payload.userId` (ya presente en `ExtensionAccessTokenPayload`, sin trabajo nuevo de auth) |
| `apps/web/src/app/api/bot/start/route.ts` | Modificar | Exigir `ownerEmail` en el body; `UserRepository.findByEmail`; 400 si falta o es desconocido |
| `apps/worker/src/integrations/calendar/types.ts` | Modificar | `CalendarMeetingEvent` gana `ownerUserId: string`, `participantEmails: string[]` |
| `apps/worker/src/integrations/calendar/providers/GoogleCalendarProvider.ts` | Modificar | `fetchEvents` recibe el `user.id` OAuth actual, estampa `ownerUserId`; mapea `event.attendees` → `participantEmails` |
| `apps/worker/src/services/autoJoinService.ts` | Modificar | Path primario (hay usuarios conectados por OAuth): pasa `ownerId: event.ownerUserId`, `participantEmails: event.participantEmails` a `queueMeetingRun`. Fallback acotado (cero usuarios OAuth, lista estática de env `AUTO_JOIN_ORGANIZER_EMAILS`): no existe ninguna fila de `users` resoluble — saltear el encolado de ese evento y loguear un warning en lugar de llamar a `queueMeetingRun` |
| `apps/web/src/repositories/WebMeetingRepository.ts` | Modificar | `listRecent(userId)` / `listFiltered(userId, filters)` — filtro de ownership+grant+owner-activo (ver Interfaces) |
| `apps/web/src/repositories/MeetingAccessGrantRepository.ts` callers (`apps/web/src/app/(main)/**` pages) | Modificar | Propagar `session.user.id` a las llamadas del repositorio |
| `packages/shared/src/meetingProvider.ts` | Modificar | Agregar `sanitizeMeetingNameForStorageKey(name)` y `buildNamedRecordingStorageKey(meetingId, meetingName, recordedAt, providerHint)`; `buildRecordingStorageKey()` sin tocar (fallback legacy) |
| `apps/worker/src/services/meetingWorkerService.ts` | Modificar | En la subida: calcular `buildNamedRecordingStorageKey(...)`, persistir en `meetings.recordingStorageKey` junto con `recordingFilePath` |
| `apps/worker/src/services/meetingRecoveryService.ts` | Modificar | Resolver la clave vía `meeting.recordingStorageKey ?? buildRecordingStorageKey(...)` |
| `apps/web/src/services/meetingShareService.ts` | Modificar | Mismo resolve-then-fallback para URLs firmadas; `createShare` exige `callerId` y lanza excepción salvo que `callerId === meeting.ownerId`; elimina la rama `"public"` |
| `apps/web/src/commands/meeting/DeleteMeetingCommand.ts` | Modificar | Mismo resolve-then-fallback antes de llamar al delete de storage |
| `apps/web/src/app/api/meetings/[id]/route.ts` | Modificar | Mismo resolve-then-fallback |
| `apps/web/src/app/api/v1/extension/meetings/[id]/route.ts` | Modificar | Mismo resolve-then-fallback |
| `apps/web/src/app/(main)/meeting/[id]/page.tsx` | Modificar | Mismo resolve-then-fallback |
| `apps/web/src/integrations/sharing/types.ts` | Modificar | `ShareType = "restricted_email"` (elimina `"public"`) |
| `apps/web/src/integrations/sharing/SharingProvider.ts` | Modificar | `readonly type: "restricted_email"` |
| `apps/web/src/integrations/sharing/SharingProviderFactory.ts` | Modificar | Elimina el case `"public"` |
| `apps/web/src/integrations/sharing/providers/PublicSharingProvider.ts` | Eliminar | Ya no es alcanzable |
| `apps/web/src/integrations/sharing/shareTtl.ts` | Crear | Extrae `DEFAULT_SHARE_TTL_OPTIONS_MINUTES`, `getConfiguredTtlOptionsMinutes`, `resolveExpiresAt` — importado tanto por `meetingShareService.ts` como por el nuevo `meetingAccessGrantService.ts` |
| `apps/web/src/services/meetingAccessGrantService.ts` | Crear | `createGrant`, `listGrantsByMeetingId`, `revokeGrant` — espeja a `MeetingShareService`, reusa `shareTtl.ts` |
| `apps/web/src/app/actions/grants.ts` | Crear | `createGrantAction`, `revokeGrantAction` — espeja a `shares.ts`, ambas exigen `session.user.id === meeting.ownerId` |
| `apps/web/src/app/actions/shares.ts` | Modificar | `createShareAction` resuelve la sesión, pasa `callerId` a `MeetingShareService.createShare` |
| `apps/web/src/components/MeetingDetailsView.tsx` | Modificar | Elimina `"public"` de state/options/labels/rendering de `shareType`; agrega UI de creación de grants (lista de sugerencias por participant + ingreso manual de email) |
| `apps/web/src/integrations/chat/tools/definitions.ts` | Modificar | `enqueueMeetingTool.execute`: resuelve la sesión, pasa `ownerId`; `manageMeetingShareTool`: elimina `"public"` del enum `share_type`, rutea `create`/`revoke` a través de `MeetingShareService`/el nuevo grant service (no directamente `MeetingShareRepository.create`) con el mismo chequeo de ownership |

## Interfaces / Contratos

```typescript
// packages/shared/src/services/meetingQueueService.ts
export interface StartMeetingParams {
  meetingUrl: string;
  botName: string;
  duration: number;
  ownerId: string;                 // NEW — mandatory, users.id
  participantEmails?: string[];    // NEW — calendar event.attendees, optional
  providerHint?: string;
  meetingId?: string;
  sourceProvider?: string;
  sourceEventId?: string;
  organizerEmail?: string;
  startsAt?: Date;
  endsAt?: Date;
}
export async function queueMeetingRun(params: StartMeetingParams): Promise<{ id: string }>;
```

```typescript
// packages/shared/src/repositories/MeetingAccessGrantRepository.ts
export type MeetingAccessGrantRecord = typeof meetingAccessGrants.$inferSelect;
export type MeetingAccessGrantInsert = typeof meetingAccessGrants.$inferInsert;

export class MeetingAccessGrantRepository {
  static async create(values: MeetingAccessGrantInsert): Promise<void>;
  static async findById(id: string): Promise<MeetingAccessGrantRecord | null>;
  static async listByMeetingId(meetingId: string): Promise<MeetingAccessGrantRecord[]>;
  static async findLiveGrant(
    meetingId: string,
    granteeUserId: string,
    now?: Date,
  ): Promise<MeetingAccessGrantRecord | null>; // revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)
  static async revokeById(id: string, when?: Date): Promise<void>;
}
```

```typescript
// apps/web/src/repositories/WebMeetingRepository.ts
export class WebMeetingRepository {
  static async listRecent(userId: string): Promise<MeetingRecord[]>;
  static async listFiltered(userId: string, filters: MeetingFilters): Promise<MeetingRecord[]>;
  // WHERE (meetings.ownerId = :userId OR EXISTS (
  //   SELECT 1 FROM meeting_access_grants g
  //   WHERE g.meetingId = meetings.id AND g.granteeUserId = :userId
  //     AND g.revokedAt IS NULL AND (g.expiresAt IS NULL OR g.expiresAt > now())
  // ))
  // AND EXISTS (
  //   SELECT 1 FROM authorized_accounts a JOIN users u ON u.email = a.email
  //   WHERE u.id = meetings.ownerId AND a.isActive = true
  // )
}
```

```typescript
// apps/web/src/services/meetingAccessGrantService.ts (mirrors MeetingShareService's TTL shape)
export interface CreateGrantInput {
  meetingId: string;
  granteeUserId: string;
  callerId: string;       // must equal meeting.ownerId or throw
  ttlMinutes?: number;
  noExpiry?: boolean;
}
export class MeetingAccessGrantService {
  static async createGrant(input: CreateGrantInput): Promise<{ id: string; expiresAt: Date | null }>;
  static async listGrantsByMeetingId(meetingId: string): Promise<MeetingAccessGrantRecord[]>;
  static async revokeGrant(grantId: string, callerId: string): Promise<void>;
}
```

```typescript
// packages/shared/src/meetingProvider.ts — additions, buildRecordingStorageKey() unchanged
export function sanitizeMeetingNameForStorageKey(name: string | null | undefined): string {
  // lowercase, replace anything outside [a-z0-9-_] with "-", collapse repeats, trim, fallback "meeting"
}
export function buildNamedRecordingStorageKey(
  meetingId: string,
  meetingName: string | null | undefined,
  recordedAt: Date,
  meetingUrl: string,
  providerHint?: string,
): string {
  const provider = resolveMeetingProvider(meetingUrl, providerHint);
  const date = recordedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const safeName = sanitizeMeetingNameForStorageKey(meetingName);
  return `${provider}/${safeName}_${date}_${meetingId}.mp4`;
}
```

```typescript
// apps/web/src/app/api/bot/start/route.ts — machine-to-machine owner resolution
const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
if (!ownerEmail) return NextResponse.json({ error: "ownerEmail is required" }, { status: 400 });
const owner = await UserRepository.findByEmail(ownerEmail);
if (!owner) return NextResponse.json({ error: "ownerEmail does not match a registered user" }, { status: 400 });
// owner.id passed as ownerId to MeetingService.enqueueMeeting
```

## Esquema (Drizzle)

```typescript
export const meetings = pgTable("meetings", {
  // ...existing columns...
  ownerId: text("owner_id").notNull().references(() => users.id),
  recordingStorageKey: text("recording_storage_key"),
  participantEmails: jsonb("participant_emails").$type<string[]>(),
}).enableRLS();

export const shareTypeEnum = pgEnum("share_type", ["restricted_email"]);

export const meetingAccessGrants = pgTable("meeting_access_grants", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  ownerId: text("owner_id").notNull(),
  granteeUserId: text("grantee_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).enableRLS();
```

### Mecanismo de migración para eliminar `"public"` (Postgres no puede hacer `ALTER TYPE ... DROP VALUE`)

```sql
-- 1. Revoke existing "public" shares (spec requirement)
UPDATE meeting_shares SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
WHERE share_type = 'public';

-- 2. Relabel them to a value that survives the new enum. Safe because resolvePublicShare()
--    checks revokedAt before ever branching on shareType — a revoked row's shareType is inert.
UPDATE meeting_shares SET share_type = 'restricted_email' WHERE share_type = 'public'::share_type;

-- 3. Recreate the enum without "public" and repoint the column
ALTER TYPE "share_type" RENAME TO "share_type_old";
CREATE TYPE "share_type" AS ENUM('restricted_email');
ALTER TABLE "meeting_shares" ALTER COLUMN "share_type" TYPE "share_type" USING "share_type"::text::"share_type";
DROP TYPE "share_type_old";

-- 4. New columns / table (see schema section above for full DDL)
ALTER TABLE "meetings" ADD COLUMN "owner_id" text NOT NULL REFERENCES "users"("id");
ALTER TABLE "meetings" ADD COLUMN "recording_storage_key" text;
ALTER TABLE "meetings" ADD COLUMN "participant_emails" jsonb;
CREATE TABLE "meeting_access_grants" ( ... );
```

Según la Nota de migración del spec, este repo aplica un reset de la DB junto con la migración (las
filas existentes son datos de prueba), así que el `NOT NULL` del paso 4 no necesita ningún camino de
compatibilidad hacia atrás y los pasos 1–3 son, en la práctica, un no-op acá — están escritos por
corrección, pensando en cualquier dataset futuro que no sea de prueba.

## Estrategia de testing (TDD — se requiere un test RED para cada ítem de lógica de abajo; UI/multimedia exento según AGENTS.md)

| Capa | Qué testear | Ubicación del test RED |
|---|---|---|
| `queueMeetingRun` exige `ownerId` | Lanza/rechaza el insert sin él; propaga `ownerId`/`participantEmails` | `apps/__tests__/shared/services/meeting-queue-service.test.ts` |
| Acotamiento de `WebMeetingRepository.listRecent`/`listFiltered` | El Owner ve las suyas; el grantee ve las otorgadas (solo vigentes); deniega las vencidas/revocadas; deniega las reuniones de owner desactivado; sin bypass de admin | `apps/__tests__/web/repositories/web-meeting-repository.test.ts` |
| `MeetingAccessGrantRepository` | Semántica de expiración+revocación de create/list/findLiveGrant | `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` |
| Chequeo de ownership de `MeetingAccessGrantService.createGrant`/`revokeGrant` | El no-owner es rechazado; el owner tiene éxito; se reusa el menú de TTL | `apps/__tests__/web/services/meeting-access-grant-service.test.ts` |
| Retrofit de ownership de `MeetingShareService.createShare` | El no-owner es rechazado; el owner tiene éxito; el shareType `"public"` es rechazado | `apps/__tests__/web/services/meeting-share-service.test.ts` |
| `sanitizeMeetingNameForStorageKey` / `buildNamedRecordingStorageKey` | Casos límite de sanitización (unicode, barras, nombre vacío); formato de fecha; sufijo a prueba de colisiones | `apps/__tests__/shared/meeting-provider.test.ts` |
| Resolve-then-fallback de la storage key (cada uno de los 7 sitios de retrofit) | Usa `recordingStorageKey` cuando está presente; recurre a `buildRecordingStorageKey()` cuando es null | Extender el archivo de test existente de cada sitio, bajo `apps/__tests__/{web,worker}/...` |
| Captura de attendee/owner de `GoogleCalendarProvider` | `ownerUserId` estampado por usuario OAuth; `event.attendees` mapeado a `participantEmails`; el path de fallback de service-account no produce `ownerUserId` y se saltea | `apps/__tests__/worker/calendar/google-calendar-provider.test.ts` |
| `autoJoinService` skip-when-ownerless | Los eventos sin `ownerUserId` no se encolan | Extender `apps/__tests__/worker/shared/auto-join-service.test.ts` |
| Resolución de ownerEmail de `/api/bot/start` | 400 cuando falta o es desconocido; encola con el `ownerId` resuelto | `apps/__tests__/web/api/bot-start.test.ts` |
| Ownership en las chat tools | `enqueue_meeting` setea `ownerId` desde la sesión; `manage_meeting_share` rechaza el create/revoke de un no-owner, rechaza `"public"` | `apps/__tests__/web/integrations/chat-tools-definitions.test.ts` |
| Exento (UI/multimedia, según AGENTS.md) | Eliminación/agregado de UI en `MeetingDetailsView.tsx`; las llamadas de subida a FFmpeg/S3 en sí mismas | Solo validación manual/de integración |

## Matriz de amenazas

N/A — este cambio no introduce routing, shell, subproceso, automatización de VCS/PR, clasificación de
archivos ejecutables, ni límites de integración de procesos.

## Migración / Despliegue

Una única migración `drizzle/0006_meeting_ownership_and_sharing.sql` aplicada junto con un reset de la
DB (solo datos de prueba, según la Nota de migración del spec) — no se necesita rollout por fases ni
feature flag. Sin backfill de `recordingStorageKey` para grabaciones preexistentes (fuera de alcance
explícito).

## Preguntas abiertas

Ninguna. Los dos ítems abiertos previos ya están resueltos (ver la tabla de Decisiones de arquitectura):

- Que `/api/bot/start` exija `ownerEmail` solo afecta al modo de auth por legacy-token de la extensión
  (confirmado vía `apps/extension/src/background/api-client.ts` `resolveTransport` y
  `docs/extension.md`); el modo moderno de sesión enlazada ya rutea a través de
  `/api/v1/extension/bot/start`, que no necesita ningún cambio de diseño.
- El fallback acotado de `autoJoinService` que solo depende de la env var (cero usuarios conectados por
  OAuth) saltea el encolado con un warning logueado en lugar de fabricar un ownership; el path primario
  de usuarios conectados por OAuth propaga un `ownerId` real.
