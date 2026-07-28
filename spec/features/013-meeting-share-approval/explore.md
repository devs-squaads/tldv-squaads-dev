# Exploración: Aprobación de Admin para Compartidos de Member (ADR-0008) + Proveedor SMTP (ADR-0004)

ADRs fuente: `docs/adr/0004-smtp-email-provider.md`, `docs/adr/0008-member-share-admin-approval.md`.
Vocabulario de dominio: `docs/CONTEXT.md` (sección "Meeting Ownership & Sharing" — `Owner`, `Access Grant`,
`Participant`, `Auto-Join Co-Attendee Grant`, `Share Request`).

## Estado Actual

**Schema** (`packages/shared/src/db/schema.ts`): `meetings` (L43-80, `ownerId` FK notNull, índice parcial
único sobre `(sourceProvider,sourceEventId)` L76-78 — intacto según ADR-0007). `authorizedAccountRoleEnum =
["admin","member"]` (L17), `authorizedAccounts` (L19-27, a nivel de plataforma, sin `meetingId`).
`shareTypeEnum = ["restricted_email"]` únicamente (L87). `meetingShares` (L97-112): sin columna de estado
más allá de `expiresAt`/`revokedAt` — no existe ningún concepto de pending/approved/rejected.
`meetingAccessGrants` (L123-144): índice único incondicional sobre `(meetingId, granteeUserId)` (L142, el
árbitro de ADR-0007), sin columna de tipo de acceso — `temporary`/`permanent` mapean limpiamente a
`expiresAt`, pero hoy nada los distingue. **No existe ninguna superficie de Share Request en ningún lado.**

**Sharing service/repos**: `MeetingShareService.createShare` (`apps/web/src/services/meetingShareService.ts:129-196`)
verifica estrictamente `callerId !== meeting.ownerId` → throw (L134-136), sin bifurcación por rol.
`revokeShare` (L217-229) sigue el mismo patrón (L222-227). `renewShareAccess`/`regenerateShareLink` **no
tienen ningún chequeo de caller** (L240-288). `MeetingAccessGrantService.requireOwnedMeeting`
(`apps/web/src/services/meetingAccessGrantService.ts:23-32`) es el gate equivalente para los grants —
mismo patrón estricto de solo-owner. `MeetingAccessGrantRepository.existsForMeetingAndGrantee`/
`createDedupedForMeetingAndGrantee` (`packages/shared/src/repositories/MeetingAccessGrantRepository.ts:31-76`)
son las primitivas de idempotencia de ADR-0007 — patrón reutilizable, pero ese camino queda intacto. La
interfaz `SharingProvider` hardcodea `readonly type: "restricted_email"` (`SharingProvider.ts:21`).

**Email layer**: `EmailProviderFactory.getProvider()` (`EmailProviderFactory.ts:7-22`) solo distingue
`"console"`, y el default también cae a console con un warning — nunca falla ante config
desconocida/faltante, coincidiendo con el comportamiento de fallback que exige ADR-0004. Confirmado por
grep: exactamente **2** call sites literales de `EmailProviderFactory.getProvider().send(` —
`meetingShareService.ts:182` y `:280` — más un 3er send lógico dentro de
`RestrictedEmailSharingProvider.requestAccess` (`providers/RestrictedEmailSharingProvider.ts:38-59`,
inyectado por constructor vía `SharingProviderFactory.ts:28`). No existen otros callers en ningún lugar
del repo. `nodemailer` no está en **ningún** `package.json` (web/worker/extension/shared/root) — solo de
forma transitiva en `bun.lock`; habría que agregarlo únicamente a `apps/web/package.json` (el único dueño
de `integrations/email/**`). **No existe ningún archivo `.env*.example` en todo el repo** (glob
`**/.env*` = 0 matches) — solo `README.md:190` documenta `EMAIL_PROVIDER` en una tabla; esa es la única
superficie de docs que realmente existe para sincronizar.

**Admin/role check**: el callback `jwt` de JWT en `auth.ts` (L142-206) re-resuelve `token.role` desde
`AuthorizedAccountRepository.findAuthorizedAccount` en cada request (L160-166); el callback `session`
(L208-214) lo copia a `session.user.role` (tipado en `types/next-auth.d.ts:4-12` como
`"admin"|"member"`). Chequeo idiomático, ya usado en `app/api/admin/authorized-accounts/route.ts:12,25`:
`if (session.user.role !== "admin") return 403`. **Todavía no se usa en ninguna server action** —
`app/actions/shares.ts:8-14` y `grants.ts:7-13` solo obtienen `session.user.id` vía un `requireCallerId()`
local. `WebMeetingRepository.visibleToUser` (`apps/web/src/repositories/WebMeetingRepository.ts:15-41`)
documenta explícitamente que no hay bypass de rol para la **visibilidad** de la reunión — algo no
relacionado con la autoridad de compartir, no debe tocarse ni confundirse.

**Participant/share UI** (`apps/web/src/components/MeetingDetailsView.tsx`, 1129 líneas):
`handleCreateShare` (L178-219, email manual), `handleGrantParticipant`/`handleShareWithParticipant`
(L223-279, por sugerencia de participante), `handleRevokeShare`/`handleResendShare`/`handleRenewShare`/
`handleClearInactiveShares` (L281-399). Comentario de diseño explícito (L221-222): **"nunca una acción
masiva de 'compartir con todos' — el Owner revisa cada uno por su cuenta"** — así que el modo "compartir
con todos los participantes" de ADR-0008 es UI genuinamente nueva, no una extensión. Render: card
"Compartir reunión" (L990-1125) → filas de sugerencia de participante (L1006-1050) → controles de email
manual + TTL (L1052-1106) → `restrictedShares.map(renderShareRow)` (L1120, row definida en L486+) es el
**único** lugar donde un Share Request rechazado/pendiente podría surgir pasivamente — y solo para el
camino de `meeting_shares` (destinatario no registrado). Los grants de destinatario registrado **no
tienen ningún render de lista persistida** en este componente (`handleGrantParticipant` solo cambia
estado local efímero a "done") — un gap real para la fase de diseño.

**Navbar/layout**: no existe ningún componente Navbar/Header compartido. `(main)/page.tsx:26-60`,
`(main)/settings/page.tsx:19-40` y `(main)/meeting/[id]/page.tsx:65-77` cada uno arma a mano su propio
JSX `<header>` inline idéntico. Una campanita+badge toca al menos 3 archivos si no se extrae.
`UserMenu.tsx` (dropdown que abre/cierra al hacer click afuera, L8-21) es el precedente estructural más
cercano para un componente de dropdown de campanita.

**Precedente de página nueva**: `(main)/settings/page.tsx` — server component, `force-dynamic`, fetch
server-side → props de client component. Todavía no existe ningún guard de ruta basado en rol
(`lib/pageAuthGuard.ts:13-15` solo chequea si tiene algún rol), así que una futura página admin-only
necesita su propio chequeo inline `session.user.role !== "admin"`, igual que el patrón
`redirect("/login")` de `(main)/page.tsx:21`.

**Tests**: `apps/__tests__/web/services/meeting-share-service.test.ts` cubre createShare/revokeShare
owner-vs-non-owner + rechazo público (L107-169) y los casos de signed-URL de verifyRestrictedAccess
(L195-226) — sin cobertura para renewShareAccess/regenerateShareLink/resolvePublicShare/requestRestrictedAccess.
`apps/__tests__/web/services/meeting-access-grant-service.test.ts` cubre por completo create/list/revoke
owner-gating. Las aserciones `"rejects a non-owner caller"` de ambos archivos van a necesitar nuevos casos
de bifurcación admin/member. `admin-authorized-accounts-route.test.ts` es el precedente para testear el
patrón 403-on-non-admin. Todavía no existe ningún archivo de test para `integrations/email/**` ni para
`integrations/sharing/{SharingProviderFactory,RestrictedEmailSharingProvider}.ts` directamente (solo
cobertura indirecta vía los mocks de meeting-share-service) ni para `MeetingShareRepository`.

## Áreas Afectadas

- `packages/shared/src/db/schema.ts` — necesita nuevo estado/tabla/enum de Share Request y una
  distinción de tipo de acceso; hoy no existen esas columnas.
- `apps/web/src/services/meetingShareService.ts`, `meetingAccessGrantService.ts` — los chequeos
  owner-only necesitan una bifurcación basada en rol.
- `apps/web/src/integrations/email/**` — nuevo `SmtpEmailProvider`, `apps/web/package.json` (agregar
  `nodemailer`).
- `apps/web/src/auth.ts` / server actions — el patrón de chequeo de admin existe solo en routes, no en
  actions; se necesita un helper nuevo.
- `apps/web/src/components/MeetingDetailsView.tsx` — 3 modos nuevos de selección de destinatario se
  adjuntan dentro de la card "Compartir reunión" existente; la lista de destinatario registrado hoy no
  tiene superficie de render.
- `apps/web/src/app/(main)/{page,settings/page,meeting/[id]/page}.tsx` — 3 headers inline duplicados,
  cada uno necesita la campanita.
- `apps/__tests__/web/services/{meeting-share-service,meeting-access-grant-service}.test.ts` — los tests
  de owner-gate existentes necesitan casos nuevos.
- `README.md` (docs de env) — único target de sync existente; no existen archivos `.env*.example` en el
  repo.

## Preguntas Abiertas para Spec

1. Cómo modelar el estado de Share Request sin alterar la semántica existente de revoke/expire de
   `meetingShares`/`meetingAccessGrants`.
2. Dónde viven realmente la campanita/badge y la página admin-only dado que hoy no existe ningún Navbar
   compartido.
3. Cómo surge pasivamente un Share Request rechazado de destinatario registrado dado que no existe UI de
   lista de grants.

## Riesgos

- Los Share Requests rechazados de destinatario registrado (camino Access Grant) no tienen ninguna
  superficie de UI existente donde renderizarse pasivamente (gap de diseño, no un blocker, pero debe
  decidirse en spec/design).
- No existe ningún archivo `.env*.example` en el repo, pese a la convención de sync de env declarada en
  AGENTS.md — el spec debe aclarar que README.md es, por ahora, el único target real de sync.
- El patrón de chequeo de rol admin hoy es route-only; introducirlo en server actions/services es
  plomería nueva, no un copy-paste.

## Listo para Proposal

Sí — el estado del codebase está completamente mapeado con citas file:line; `sdd-propose` puede proceder.
