# Diseño: Aprobación de Admin para Compartidos de Member + Proveedor SMTP de Email Real

## Enfoque Técnico

Se introduce `Share Request` como una **tabla nueva dedicada** (`meeting_share_requests`) que gatea —
nunca reemplaza — los dos mecanismos subsiguientes existentes de 009 (`meeting_access_grants`,
`meeting_shares`). La bifurcación por rol vive en la capa de server-action (rutea hacia request vs.
directo) con un guard defense-in-depth dentro de los services (la creación directa de un member lanza
throw). Un nuevo `ShareRequestService` es dueño del ciclo de vida
pending → approved | rejected | cancelled; la aprobación reingresa a los paths existentes de
`MeetingAccessGrantService.createGrant` / `MeetingShareService.createShare` en nombre del Owner, de modo
que el envío de email y el dedup (ADR-0007) queden en un solo lugar. `SmtpEmailProvider` (Nodemailer) se
enchufa en el `EmailProviderFactory` existente sin ningún cambio en los callers. La campanita fuerza la
extracción del header compartido que las 3 páginas hoy duplican.

## Decisiones de Arquitectura

| Decisión | Elección | Alternativas consideradas | Justificación |
|---|---|---|---|
| Persistencia del Share Request | Tabla nueva `meeting_share_requests` (una fila por destinatario) | Columnas de estado pendiente en `meetingShares`/`meetingAccessGrants` | Las filas pendientes en `meetingShares` requerirían un `tokenHash` (NOT NULL) falso y se filtrarían en `listSharesByMeetingId`/`resolvePublicShare`; las filas pendientes en `meetingAccessGrants` colisionarían con el árbitro de dedup único `(meetingId, granteeUserId)` de ADR-0007 (un request rechazado bloquearía un grant real posterior). Una tabla separada mantiene intacta la semántica de revoke/expire de ambas tablas y preserva el rastro de auditoría que exige ADR-0008 (propuesto vs. aprobado, rechazos persistidos) |
| Modelado del destinatario en el request | `granteeUserId` (registrado) XOR `recipientEmailNormalized` (no registrado), un CHECK constraint exige exactamente uno | Una única columna de email en texto libre, resuelta al momento de la aprobación | Resolver al momento del request es cuando se decide la elegibilidad de `single_use` (solo no registrados); resolver más tarde podría cambiar silenciosamente el significado del request entre la propuesta y la aprobación |
| Modelado del tipo de acceso | Enum `share_request_access_type = ["single_use","temporary","permanent"]` + `expiresInDays` nullable (requerido si y solo si `temporary`); en `meeting_shares`, nuevo `singleUse boolean NOT NULL DEFAULT false` | Codificar el tipo de acceso solo como matemática de `expiresAt` | `single_use` es ortogonal a la expiración (muere en la primera verificación OTP `verifyAccess()` exitosa, reutilizando `revokedAt` según ADR-0008) — necesita un flag persistido en la propia fila de share para que `verifyRestrictedAccess` pueda revocar en el primer éxito. Los Owners admin también obtienen los 3 tipos de acceso directamente, así que el flag pertenece a `meeting_shares` independiente de los requests |
| Prevención de pendientes duplicados | Dos índices parciales únicos: `(meetingId, granteeUserId) WHERE status='pending'` y `(meetingId, recipientEmailNormalized) WHERE status='pending'` | Chequeo solo a nivel de aplicación | Mismo idioma de "el insert es el árbitro" que ADR-0007; a prueba de race conditions, un request por destinatario |
| Dónde vive la bifurcación por rol | Las actions (`shares.ts`/`grants.ts`) resuelven `{ id, role }` una vez vía el nuevo `requireCaller()` compartido y rutean a los Owners member hacia `ShareRequestService`; los services además aceptan un `callerRole` opcional y lanzan throw en la creación directa de un member | Bifurcar solo en los services (el service crea el request internamente) | Los services mantienen responsabilidades únicas (crear vs. proponer); las rutas M2M de `API_ROUTE_SECRET` (sin sesión) siguen pasando `callerId: undefined` intacto; el guard a nivel de service sigue protegiendo a los callers que no son actions (la tool de chat `manage_meeting_share`) de saltarse la aprobación |
| Mecanismo de chequeo de rol admin | Reutilizar `session.user.role` de NextAuth (ya re-resuelto por request en el callback jwt de `auth.ts`); el nuevo `requireCaller(): Promise<{ id, role }>` en `apps/web/src/lib/sessionCaller.ts` reemplaza los dos helpers `requireCallerId()` duplicados | Middleware nuevo / lookup a DB por action | El rol ya está fresco en cada request (explore.md, `auth.ts` L142-206); plomearlo es un parámetro, no un mecanismo nuevo |
| La aprobación se ejecuta como el Owner | `approveShareRequest` llama a `createGrant`/`createShare` con `callerId = meeting.ownerId` (el solicitante) | Relajar los chequeos de owner para aceptar callers admin | Mantiene los gates de owner de 009 byte-idénticos para el camino directo; el service de aprobación es el único punto de impersonación sancionado, y la auditoría vive en `resolvedBy` |
| Revocación por member | El Owner member revoca sus propios shares/grants **directamente** (el gate de owner no cambia); solo la *creación* pasa por Share Request | Lectura literal de ADR-0008 ("revokeShare gana la bifurcación") = revocar también necesitaría aprobación | El ciclo de vida del Share Request modela solo *propuestas* de compartido (la aprobación crea una fila; el rechazo no crea nada — no existe semántica de revoke en el propio modelo de ADR-0008), y bloquear a un member de contener un compartido accidental es una anti-feature de seguridad. Esto acota la única oración de ADR-0008; señalado en Riesgos |
| Superficie pasiva de request rechazado (camino registrado) | Nueva sección "Solicitudes y accesos" dentro de la card "Compartir reunión" existente: renderiza los Share Requests de esta reunión (todos los estados, ambos caminos) vía `listShareRequestsByMeetingIdAction`, más una lista mínima de Access Grants vía el `listGrantsAction` existente, espejando `restrictedShares.map(renderShareRow)` | Página separada; toast/notificación | Cierra el gap de explore.md (los grants no tenían superficie de render) en el único lugar donde el Owner ya mira; descubrimiento pasivo según los non-goals de la propuesta |
| Ubicación de la campanita | Extraer el server component `AppHeader` compartido usado por las 3 páginas; la campanita (`PendingRequestsBell`, client, modelada sobre `UserMenu.tsx`) se renderiza adentro, admin-only, badge = `countPending()` obtenido server-side en cada render, con link a la página admin | Insertar la campanita en cada uno de los 3 headers armados a mano | La triplicación ya existe (explore.md); agregar una 4ta copia de JSX de header por página para evitar un componente es al revés. Sin polling — la cuenta se refresca en la navegación, acorde a la semántica "no-leído = pending" |
| Ruta + guard de la página admin | `apps/web/src/app/(main)/admin/share-requests/page.tsx`, server component `force-dynamic` (precedente de la página de settings): sin sesión → `redirect("/login")`; `session.user.role !== "admin"` → `redirect("/")` | Extender `pageAuthGuard.ts` con soporte genérico de rol | Solo existe una página admin; el chequeo inline sigue el idioma existente de `admin/authorized-accounts/route.ts`. Generalizar cuando aparezca una segunda página admin |
| Ubicación del fallback de SMTP | Dentro de `SmtpEmailProvider.send()`: config completa → send de nodemailer; incompleta + `NODE_ENV === "production"` → throw (bloquea el envío); incompleta en cualquier otro caso → warning en log + comportamiento de console-provider | Chequeo de env en `EmailProviderFactory` | El factory se mantiene como un switch puro por nombre (su contrato actual, explore.md); el provider es dueño de su propia operabilidad según el "chequeo prod-aware dentro del provider" explícito de ADR-0004 |
| "Compartir con todos" masivo | La UI itera la action de destinatario único por cada `Participant` | Action de batch server-side | Un request por destinatario es el contrato; la card existente ya funciona por-destinatario (explore.md L221-222), reutilizar el patrón |

## Flujo de Datos

    Owner hace click en compartir (cualquiera de los 3 modos, por destinatario)
      └─ la action resuelve requireCaller() → { id, role }
          ├─ role=admin  → MeetingAccessGrantService.createGrant / MeetingShareService.createShare
          │                 (directo, sin cambios respecto de 009 + mapeo de singleUse/accessType)
          └─ role=member → ShareRequestService.createShareRequest → meeting_share_requests (pending)

    Campanita admin (AppHeader, role=admin) ── countPending() ──→ /admin/share-requests
      └─ approve → ShareRequestService.approveShareRequest (requiere role=admin)
      │             ├─ registrado    → createGrant(callerId = requesterId)   [temporary/permanent]
      │             └─ no registrado → createShare(callerId = requesterId)   [+ singleUse] → email SMTP
      │             └─ status=approved, resolvedBy/At, resolvedGrantId|resolvedShareId
      └─ reject  → status=rejected (no crea nada)
    Cancelación de member (solo pending, solo el solicitante) → status=cancelled

    Owner vuelve a abrir la card de la reunión → listShareRequestsByMeetingId + listGrants → descubrimiento pasivo

    EmailProviderFactory("smtp") → SmtpEmailProvider.send
      ├─ config OK      → transporte nodemailer (SMTP_HOST/PORT/USER/PASS/FROM)
      ├─ config faltante + producción → throw (envío bloqueado, ruidoso)
      └─ config faltante + dev/local  → fallback a console

## Schema (Drizzle)

```typescript
export const shareRequestStatusEnum = pgEnum("share_request_status",
  ["pending", "approved", "rejected", "cancelled"]);
export const shareRequestAccessTypeEnum = pgEnum("share_request_access_type",
  ["single_use", "temporary", "permanent"]);

export const meetingShareRequests = pgTable("meeting_share_requests", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  requesterId: text("requester_id").notNull(),          // == meeting.ownerId at creation
  granteeUserId: text("grantee_user_id"),               // registered recipient (XOR next two)
  recipientEmail: text("recipient_email"),
  recipientEmailNormalized: text("recipient_email_normalized"),
  accessType: shareRequestAccessTypeEnum("access_type").notNull(),
  expiresInDays: integer("expires_in_days"),            // required iff accessType = temporary
  status: shareRequestStatusEnum("status").notNull().default("pending"),
  resolvedBy: text("resolved_by"),                      // admin users.id
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedGrantId: text("resolved_grant_id"),
  resolvedShareId: text("resolved_share_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("msr_pending_grantee_uq").on(t.meetingId, t.granteeUserId)
    .where(sql`status = 'pending' AND grantee_user_id IS NOT NULL`),
  uniqueIndex("msr_pending_email_uq").on(t.meetingId, t.recipientEmailNormalized)
    .where(sql`status = 'pending' AND recipient_email_normalized IS NOT NULL`),
]).enableRLS();

// meetingShares gains:
singleUse: boolean("single_use").notNull().default(false),
```

Migración: el siguiente `drizzle/NNNN_meeting_share_requests.sql` secuencial (2 enums, tabla + CHECK
`(grantee_user_id IS NOT NULL) <> (recipient_email_normalized IS NOT NULL)`, índices parciales únicos,
`meeting_shares.single_use` con default — aditiva, sin necesidad de backfill).

## Interfaces / Contratos

```typescript
// apps/web/src/lib/sessionCaller.ts
export interface SessionCaller { id: string; role: "admin" | "member" }
export async function requireCaller(): Promise<SessionCaller>; // throws "Unauthorized"

// apps/web/src/services/shareRequestService.ts
export interface CreateShareRequestInput {
  callerId: string;                       // must equal meeting.ownerId
  meetingId: string;
  recipient: { granteeUserId: string } | { email: string };
  accessType: "single_use" | "temporary" | "permanent";
  expiresInDays?: number;                 // temporary only; UI pre-fills 15
}
export class ShareRequestService {
  static async createShareRequest(input: CreateShareRequestInput): Promise<ShareRequestRecord>;
  //  - throws if single_use + registered recipient, if non-owner, if duplicate pending
  static async cancelShareRequest(callerId: string, requestId: string): Promise<void>;   // requester + pending only
  static async approveShareRequest(caller: SessionCaller, requestId: string): Promise<void>; // admin only, pending only
  static async rejectShareRequest(caller: SessionCaller, requestId: string): Promise<void>;  // admin only, pending only
  static async listPending(): Promise<ShareRequestListItem[]>;       // admin page
  static async countPending(): Promise<number>;                      // bell badge
  static async listByMeetingId(callerId: string, meetingId: string): Promise<ShareRequestRecord[]>; // owner card
}

// Existing services — additive param, existing callers unaffected:
MeetingShareService.createShare(input, callerId?, callerRole?)   // member role → throw
MeetingAccessGrantService.createGrant({ ...input, callerRole? }) // member role → throw
// CreateShareInput gains singleUse?: boolean; verifyRestrictedAccess revokes on first
// successful verify when share.singleUse (reuses revokedAt, ADR-0008).
// createGrant maps: permanent → noExpiry, temporary → ttlMinutes = expiresInDays * 1440.

// apps/web/src/integrations/email/providers/SmtpEmailProvider.ts
export class SmtpEmailProvider implements EmailProvider {
  constructor(transportFactory?: () => Transporter); // injectable for tests
  async send(input: SendEmailInput): Promise<void>;  // prod+missing config → throw
}
// EmailProviderFactory: case "smtp" → new SmtpEmailProvider(). Env: SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS, SMTP_FROM, EMAIL_PROVIDER=smtp — documented in README.md env table
// (only real sync target; no .env*.example files exist in-repo, per explore.md).
```

## Cambios de Archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `packages/shared/src/db/schema.ts` | Modificar | 2 enums nuevos, `meetingShareRequests`, `meetingShares.singleUse` |
| `drizzle/NNNN_meeting_share_requests.sql` | Crear | La migración de arriba |
| `packages/shared/src/repositories/MeetingShareRequestRepository.ts` | Crear | `create`, `findById`, `listPending`, `countPending`, `listByMeetingId`, `resolve(id, {status, resolvedBy, resolvedGrantId?, resolvedShareId?})`, `cancel` — espeja `MeetingAccessGrantRepository` |
| `apps/web/src/lib/sessionCaller.ts` | Crear | `requireCaller()` — reemplaza los dos helpers `requireCallerId()` duplicados |
| `apps/web/src/services/shareRequestService.ts` | Crear | Service de ciclo de vida (contrato de arriba) |
| `apps/web/src/app/actions/shareRequests.ts` | Crear | `createShareRequestAction`, `cancelShareRequestAction`, `approveShareRequestAction`, `rejectShareRequestAction`, `listShareRequestsByMeetingIdAction`, `listPendingShareRequestsAction` |
| `apps/web/src/app/actions/shares.ts`, `grants.ts` | Modificar | Usar `requireCaller()`; Owner member → rutear la creación hacia `ShareRequestService`; admin → directo (la revocación se mantiene directa para ambos roles) |
| `apps/web/src/services/meetingShareService.ts` | Modificar | Guard de `callerRole`; persistencia de `singleUse` + revoke-on-first-verify en `verifyRestrictedAccess` |
| `apps/web/src/services/meetingAccessGrantService.ts` | Modificar | Guard de `callerRole`; mapeo accessType→TTL |
| `apps/web/src/integrations/sharing/types.ts` | Modificar | `CreateShareInput.singleUse?: boolean` |
| `apps/web/src/integrations/email/providers/SmtpEmailProvider.ts` | Crear | Provider de Nodemailer, fallback prod-aware |
| `apps/web/src/integrations/email/EmailProviderFactory.ts` | Modificar | Agregar el case `"smtp"` |
| `apps/web/package.json` | Modificar | Agregar `nodemailer` (+ `@types/nodemailer` dev) |
| `apps/web/src/components/AppHeader.tsx` | Crear | Header compartido extraído de los 3 `<header>`s inline duplicados |
| `apps/web/src/components/PendingRequestsBell.tsx` | Crear | Dropdown/badge client, modelado sobre `UserMenu.tsx`; admin-only; con link a la página admin |
| `apps/web/src/app/(main)/{page,settings/page,meeting/[id]/page}.tsx` | Modificar | Reemplazar los headers inline por `AppHeader`; la página de meeting además obtiene grants + share requests hacia sus props |
| `apps/web/src/app/(main)/admin/share-requests/page.tsx` | Crear | `force-dynamic`, guard de login+rol, lista pendientes con aprobar/rechazar |
| `apps/web/src/components/AdminShareRequestsView.tsx` | Crear | Vista client para la página admin |
| `apps/web/src/components/MeetingDetailsView.tsx` | Modificar | 3 modos de destinatario ("todos los Participantes" es UI nueva), controles de tipo de acceso + días, estados de pending/cancel para member, nueva sección "Solicitudes y accesos" (requests con todos los estados + lista de grants) |
| `apps/web/src/integrations/chat/tools/definitions.ts` | Modificar | `manage_meeting_share` pasa el rol del caller; el member recibe el error "requiere aprobación de admin" |
| `README.md` | Modificar | Variables de env de SMTP + fila `EMAIL_PROVIDER=smtp` en la tabla de env |

## Estrategia de Testing (TDD — RED primero; UI-visual exenta según AGENTS.md)

| Unidad | Casos | Archivo de test (espejo de `apps/__tests__/`) |
|---|---|---|
| `ShareRequestService` | member-owner crea pending; non-owner rechazado; `single_use`+registrado rechazado; `temporary` requiere días; pending duplicado rechazado; cancel: solo requester+pending; approve: admin-only, crea grant (registrado) / share+email (no registrado, respeta `singleUse`), estampa los campos resolved, tal como fue propuesto (sin edición); reject: admin-only, no crea nada; approve/reject/cancel sobre no-pending rechazado | `web/services/share-request-service.test.ts` (nuevo) |
| `MeetingShareRequestRepository` | árbitro parcial-único de pending (ambos tipos de destinatario); countPending; transiciones de resolve/cancel | `shared/repositories/meeting-share-request-repository.test.ts` (nuevo) |
| Bifurcación por rol + singleUse de `MeetingShareService` | los casos de owner-gate existentes (L107-169) ganan: `callerRole:"member"` en creación directa lanza throw, `"admin"` pasa, rol undefined (M2M) sin cambios; `verifyRestrictedAccess` revoca el share single-use en el primer éxito, la segunda verificación → `not_found` | `web/services/meeting-share-service.test.ts` (extender) |
| Bifurcación por rol + accessType de `MeetingAccessGrantService` | la creación directa de member lanza throw; admin pasa; permanent→expiración null; días de temporary→expiresAt | `web/services/meeting-access-grant-service.test.ts` (extender) |
| `SmtpEmailProvider` + factory | el factory devuelve el provider smtp; config faltante: dev → fallback a console, `NODE_ENV=production` → lanza throw y no envía; config completa → se llama al transport con to/subject/text/html/from (transport fake inyectado) | `web/integrations/smtp-email-provider.test.ts` (nuevo — primer test para `integrations/email/**`) |
| `requireCaller` | sin sesión → throw; devuelve `{id, role}` | `web/lib/session-caller.test.ts` (nuevo) |
| Gate de admin en las actions | approve/reject como member → error (precedente del idioma 403: `admin-authorized-accounts-route.test.ts`) | cubierto en `share-request-service.test.ts` vía el parámetro de rol |
| Exento | render de `AppHeader`/campanita/página admin/`MeetingDetailsView` | validación manual |

## Matriz de Amenazas

N/A — sin routing (solo rutas de página del framework), shell, subprocess, automatización de VCS/PR,
clasificación de archivos ejecutables, ni boundary de integración de procesos.

## Migración / Rollout

Una única migración aditiva (sin cambios destructivos, sin backfill). SMTP es opt-in vía
`EMAIL_PROVIDER=smtp`; volver a console es solo env. Las filas pendientes de `meeting_share_requests`
quedan inertes si se revierte el código (nada corriente abajo las lee). No se necesita ningún feature
flag.

## Preguntas Abiertas

Ninguna. Los seis ítems delegados por la propuesta quedan resueltos arriba (forma de la persistencia,
superficie de grant rechazado, plomería de chequeo de admin, extracción del header + ruta admin,
estructura/env de SMTP, plan de test).

## Riesgos

- Que la revocación de member se mantenga directa acota la oración literal de ADR-0008 "revokeShare gana
  la bifurcación" (justificación en Decisiones). Si el negocio realmente quiere revocación gateada por
  aprobación, necesita un tipo de request nuevo — señalar esto en review.
- `approveShareRequest` impersona al Owner (`callerId = requesterId`) al reingresar a los services de
  009; los tests deben fijar que este camino es inalcanzable salvo vía una aprobación autenticada como
  admin.
- Los requests referencian destinatarios resueltos al momento de la creación; un usuario registrado
  *después* de que se creó un request con email como destinatario igual obtiene el camino
  `meeting_shares` al aprobarse (aceptado — regla tal-como-fue-propuesto).
