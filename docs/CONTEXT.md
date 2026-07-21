# Auth & Access Control

Cómo se identifica y autoriza a quien llama a `apps/web`: tres esquemas de auth distintos conviven en el
mismo backend, cada uno con su propio propósito y superficie de rutas. No son intercambiables.

## Language

**Session Auth**:
Autenticación por cookie de NextAuth (JWT), para humanos navegando el dashboard en el navegador
(`/`, `/settings`, etc.). Se resuelve con `getServerSession`/`getToken`, gated por `Authorized Account`.
_Avoid_: user auth, cookie auth, login token.

**Extension Access Token**:
Token HMAC propio (no JWT de NextAuth) emitido por `POST /api/v1/extension/connect` a partir de un
`extension_link` de corta duración generado en el dashboard. Lo usa la extensión de Chrome como
`Authorization: Bearer` contra `/api/v1/extension/*`. Requiere `Session Auth` previa para generarse,
pero es un mecanismo separado una vez emitido.
_Avoid_: extension session, extension cookie, link token (ese es solo el paso intermedio de 10 min).

**API Route Secret**:
Secreto compartido (`API_ROUTE_SECRET`) como `Authorization: Bearer` para clientes externos /
máquina-a-máquina (`/api/bot/*`, `/api/meetings/*`, `/api/v1/shares/*`, `/api/v1/meetings/*`). No
depende de ningún usuario ni sesión.
_Avoid_: API key, service token.

**Authorized Account**:
Fila en `authorized_accounts` (email + rol `admin`/`member` + `isActive`) que determina si un email
puede completar `Session Auth`. Gestionada por un admin desde "Equipo" en Ajustes, o autoprovisionada
para emails en `SUPER_ADMIN_EMAILS`.
_Avoid_: allowlist entry, whitelisted user.

**Public Route**:
Superficie servida sin ningún esquema de auth, a propósito: `/share/[token]` (enlaces compartidos
externos) y `/api/v1/public/shares/*`. No confundir con rutas que simplemente no chequean auth por
omisión (bug) — esas son un gap, no una `Public Route` intencional.
_Avoid_: unprotected route (ambiguo — no distingue "público a propósito" de "gap sin querer").

# Meeting Status

El ciclo de vida de un bot de reunión y quién dice la verdad sobre él. La extensión lo muestra en dos
superficies (widget flotante dentro del Meet, popup) que deben coincidir siempre.

## Language

**Meeting Status**:
El estado canónico del ciclo de vida de un bot de reunión (`pending`, `joining`, `waiting_admission`,
`recording`, `transcribing`, `summarizing`, `completed`, o un estado de fallo). El backend (Supabase vía
web API) es la única fuente de verdad; cualquier valor retenido en el cliente es una caché cálida, no
dato canónico. No todo estado de fallo es terminal: `error`/`rejected`/`admission_timeout` sí lo son
(exigen volver a `pending` para reintentar desde cero), pero `transcription_error` es recuperable — la
grabación ya está guardada y solo falló el post-proceso de IA, así que puede volver a `transcribing`/
`summarizing`/`completed` sin re-unirse a la reunión.
_Avoid_: meeting state (genérico), status value.

**Single Poller**:
El único componente autorizado a hacer `GET` de `Meeting Status` al backend por meeting activo. Las demás
superficies (widget, popup) se suscriben a él y nunca hacen fetch propio. Su memoria en MV3 no es
persistente: al despertar, la caché está fría y debe re-fetchear antes de responder a un suscriptor tardío.
_Avoid_: polling loop (describe el mecanismo, no el rol), status source.

_Avoid_ (frase): **"fuente de estado única"** — ambigua: confunde el dueño del dato (el backend) con el
deduplicador de fetch (el Single Poller). Usar "Single Poller" para el rol y "backend" para el dueño.

# Meeting Ownership & Sharing

Quién es dueño de una grabación y cómo decide darle acceso a otros. Distinto del sistema de enlaces
externos ya existente (`meeting_shares`), que es anónimo/por token.

## Language

**Owner**:
El `users.id` del usuario autenticado que originó la grabación (quien ejecutó `INVITE_BOT` desde la
extensión, o encoló la reunión desde el dashboard), capturado al crear la fila de `meetings`. No se
deriva de `organizerEmail` (dato de calendario, puede no corresponder a ningún usuario registrado).
_Avoid_: organizer (es `organizerEmail`, un campo de calendario distinto), creator (ambiguo con
`meetingShares.createdBy`, un campo de texto libre sin FK).

**Access Grant**:
Fila en `meeting_access_grants` que le da a un `users.id` concreto (`granteeUserId`) permiso de lectura
sobre una reunión de otro `Owner`, con `expiresAt` opcional. Tabla nueva, separada de `meeting_shares`
(esa es para visitantes anónimos por token/OTP; `Access Grant` es siempre un usuario registrado con
`Session Auth`). Solo el `Owner` puede crear o revocar grants de su reunión — un `grantee` no puede
re-compartir (no hay cadenas de compartido).
_Avoid_: share (ambiguo con `meeting_shares`, el mecanismo externo), permission (genérico).

**Participant**:
Email de un asistente invitado, tomado de `event.attendees` del evento de Google Calendar que originó
la reunión (solo existe si la reunión viene de un evento de calendario, no de un link pegado a mano).
Se guarda como sugerencia de a quién compartir al terminar la grabación; el `Owner` sigue siendo quien
decide y dispara el compartido (`Access Grant` si el email es de un usuario registrado, `restricted_email`
si no lo es). No implica envío automático de email — eso es un gap documentado (sin proveedor de email
real, el enlace se comparte manualmente).
_Avoid_: attendee (usar "Participant" en el dominio de la app; "attendee" es el campo crudo de la API de
Calendar), participants count (la cuenta de presencia en vivo del DOM de Meet — dato distinto, ya usado
internamente en `GoogleMeet.ts` para detectar si el bot está solo).

**Auto-Join Co-Attendee Grant** (excepción, ver ADR-0007):
Único caso donde un `Access Grant` se crea sin acción del `Owner`. Aplica solo cuando la reunión se
originó por auto-join de calendario (no por `INVITE_BOT` ni por encolado manual desde el dashboard/chat):
si un `Participant` del mismo evento matchea el `users.email` de otro usuario registrado, ese usuario
recibe `Access Grant` automático apenas se crea la reunión. Razón: en auto-join nadie tomó la decisión
consciente de grabar, así que "el Owner decide compartir" no tiene a quién aplicarle — el Owner mismo
salió sorteado por una carrera de pollers, no por elección. Para reuniones manuales, `Participant` sigue
siendo solo sugerencia (sin cambios).
_Avoid_: usar "Access Grant" a secas para este caso sin aclarar que es la excepción automática — el
`Access Grant` normal siempre lo dispara el `Owner`.
