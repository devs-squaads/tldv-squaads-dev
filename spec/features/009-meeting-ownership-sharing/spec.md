# 009 · Meeting Ownership & Personalized Sharing

**Estado:** spec (propuesta confirmada)

## Propósito

Toda grabación DEBE pertenecer exactamente a un **Owner**. El acceso está restringido a ese Owner más
**Access Grants** explícitos y personalizados — nunca un enlace público — y opcionalmente acotados en el
tiempo. Como objetivo secundario, las claves de objeto S3 DEBEN codificar el nombre de la reunión y la
fecha para dar legibilidad operativa, y esa clave DEBE persistirse para que futuros cambios de
nomenclatura nunca desincronicen los objetos ya subidos.

El vocabulario de dominio está fijado por `docs/CONTEXT.md` (sección "Meeting Ownership & Sharing"):
**Owner**, **Access Grant**, **Participant**. Este spec usa esos términos exactos — sin sinónimos.

## Requisitos

### Requisito: Asignación del Owner de la reunión

El sistema DEBE persistir `meetings.ownerId` como clave foránea `NOT NULL` hacia `users.id`, asignada en
la creación de la reunión al usuario autenticado que ejecutó `INVITE_BOT` o encoló la reunión. El Owner
NO DEBE derivarse de `organizerEmail` ni de ningún metadato de calendario.

#### Escenario: Owner capturado en la creación a partir de la sesión que actúa

- DADO un usuario autenticado que encola una reunión o dispara `INVITE_BOT`
- CUANDO se crea la fila de `meetings`
- ENTONCES `ownerId` se asigna al `users.id` de ese usuario
- Y nunca se completa a partir de `organizerEmail`

#### Escenario: El Owner es obligatorio

- DADO un flujo de creación de reunión que no puede resolver un `users.id` autenticado
- CUANDO intenta insertar una fila de `meetings`
- ENTONCES el insert DEBE fallar (la columna es `NOT NULL`) en lugar de crear una reunión sin Owner

### Requisito: Visibilidad de reuniones acotada por ownership (sin bypass de rol)

La lista de reuniones de cada usuario autenticado DEBE estar acotada a las reuniones que posee MÁS las
reuniones sobre las que tiene un Access Grant vigente (no vencido, no revocado). `authorized_accounts.role`
(admin/member) NO DEBE otorgar visibilidad sobre las reuniones de otro usuario.

#### Escenario: El Owner ve solo sus reuniones y las reuniones con grant

- DADO que el usuario A posee la reunión M1 y tiene un Access Grant vigente sobre la reunión M2, propiedad de B
- CUANDO A lista o abre reuniones
- ENTONCES A ve M1 y M2
- Y A no ve las reuniones de ningún otro usuario

#### Escenario: El rol admin no evade el ownership

- DADO que el usuario A tiene `authorized_accounts.role = admin` y ni posee ni tiene un grant sobre la reunión M
- CUANDO A lista o abre reuniones
- ENTONCES M NO DEBE aparecer y abrirla DEBE ser denegado

#### Escenario: Un no-Owner sin grant es denegado

- DADO la reunión M, propiedad de B, sin Access Grant para el usuario A
- CUANDO A solicita la entrada de lista o el detalle de M
- ENTONCES el acceso DEBE ser denegado

### Requisito: Access Grants exclusivos del Owner

Solo el Owner de una reunión PUEDE crear o revocar Access Grants para esa reunión. Un grantee NO DEBE
volver a compartir (no hay cadenas de grants). `meeting_access_grants` DEBE registrar al grantee como un
`users.id` registrado (basado en sesión) con un `expiresAt` opcional tomado del menú de TTL de share
existente (`DEFAULT_SHARE_TTL_OPTIONS_MINUTES`: 1h / 1d / 7d / sin vencimiento).

#### Escenario: El Owner otorga acceso de lectura con una opción de TTL

- DADO el Owner O de la reunión M y el usuario registrado G
- CUANDO O crea un Access Grant para G eligiendo un TTL del menú existente (o sin vencimiento)
- ENTONCES se crea una fila de `meeting_access_grants` con `granteeUserId = G`, `grantedBy = O`, y el `expiresAt` elegido (o null)

#### Escenario: Un no-Owner no puede otorgar

- DADO el usuario X, que no es el Owner de la reunión M (sea grantee o ajeno)
- CUANDO X intenta crear o revocar un Access Grant sobre M
- ENTONCES la operación DEBE ser rechazada

#### Escenario: Un grant vencido o revocado no otorga acceso

- DADO un Access Grant cuyo `expiresAt` ya pasó o cuyo `revokedAt` está seteado
- CUANDO el grantee lista o abre la reunión
- ENTONCES el acceso DEBE ser denegado

### Requisito: Autorización de share exclusiva del Owner (fix de createShareAction)

`createShareAction` DEBE exigir que quien la invoca sea el Owner de la reunión. Un no-Owner NO DEBE
crear un share para una reunión que no posee.

#### Escenario: El Owner crea un share

- DADO el Owner O de la reunión M
- CUANDO O llama a `createShareAction` para M
- ENTONCES el share se crea

#### Escenario: Un no-Owner es rechazado

- DADO el usuario autenticado X, que no posee la reunión M
- CUANDO X llama a `createShareAction` para M
- ENTONCES DEBE ser rechazado (antes: no existía ningún chequeo de autorización)

### Requisito: Eliminar el tipo de share público

`meeting_shares.shareType` NO DEBE soportar `"public"` — se elimina del enum, del provider, de
`MeetingDetailsView` y de la chat share tool. `"restricted_email"` (con gate por OTP vía email, sin
necesidad de registro) DEBE permanecer sin cambios como el mecanismo para personas externas/no
registradas. La migración DEBE revocar cualquier fila `"public"` existente.

#### Escenario: Ya no se pueden crear shares públicos

- DADO la UI de sharing o la chat share tool
- CUANDO cualquier llamador intenta crear un share de tipo `"public"`
- ENTONCES la opción NO DEBE existir y el intento DEBE ser rechazado

#### Escenario: Los shares públicos existentes se revocan en la migración

- DADO filas preexistentes de `meeting_shares` con `shareType = "public"`
- CUANDO la migración corre
- ENTONCES esas filas DEBEN ser revocadas

#### Escenario: restricted_email se preserva

- DADO un share de tipo `"restricted_email"`
- CUANDO se crea o se consume después de este cambio
- ENTONCES DEBE comportarse exactamente igual que antes (gate por OTP de email, sin necesidad de registro)

### Requisito: Sugerencias de Participant para reuniones originadas en calendario

Para reuniones creadas a partir de un evento de Google Calendar, el sistema DEBE capturar
`event.attendees` como sugerencias de **Participant** y ofrecerlas como candidatos de sharing una vez
que la grabación termina. El Owner DEBE otorgar/compartir a cada Participant individualmente — el
sistema NO DEBE ofrecer una única acción de "otorgar a todos de una vez". Las reuniones ad-hoc (sin
evento de calendario) NO DEBEN tener lista sugerida; el Owner ingresa los emails destinatarios
manualmente.

#### Escenario: Los attendees se muestran como sugerencias por participant

- DADO una grabación terminada para una reunión creada a partir de un evento de calendario con attendees
- CUANDO el Owner abre el sharing
- ENTONCES cada attendee aparece como una sugerencia de Participant individual que el Owner confirma de a una
- Y no se ofrece ninguna acción masiva de otorgar-a-todos

#### Escenario: Una reunión ad-hoc no tiene sugerencias

- DADO una reunión creada a partir de un link pegado (sin evento de calendario)
- CUANDO el Owner abre el sharing
- ENTONCES no se muestra ninguna lista sugerida de Participant y el Owner ingresa los emails manualmente

### Requisito: Bloqueo por Owner desactivado

Cuando el `authorized_accounts.isActive` de un Owner es `false`, TODAS las reuniones de ese Owner DEBEN
volverse inaccesibles para todos, incluidos los grantees existentes — sin excepción para el acceso ya
otorgado.

#### Escenario: La desactivación bloquea a los grantees

- DADO la reunión M, propiedad de O, con un Access Grant vigente para el grantee G
- CUANDO la cuenta de O se setea `isActive = false`
- ENTONCES ni O ni G pueden listar o abrir M

### Requisito: Nomenclatura y persistencia de la storage key de la grabación

Las subidas nuevas DEBEN calcular la clave S3 una sola vez, en el momento de la subida, como
`${provider}/${sanitizedMeetingName}_${YYYY-MM-DD}_${meetingId}.mp4`, y persistirla en
`meetings.recordingStorageKey`. Delete/sign/download DEBEN usar la clave persistida cuando esté
presente. Las filas donde `recordingStorageKey` es null DEBEN recurrir a la fórmula actual
`buildRecordingStorageKey()` sin cambios. Las filas existentes NO DEBEN recibir backfill.

#### Escenario: Una subida nueva persiste la clave legible

- DADO una grabación que se está subiendo para la reunión M
- CUANDO la subida termina
- ENTONCES `meetings.recordingStorageKey` se setea a `${provider}/${sanitizedMeetingName}_${YYYY-MM-DD}_${meetingId}.mp4`
- Y delete/sign/download resuelven el objeto a través de esa clave persistida

#### Escenario: Las filas legacy usan la fórmula de fallback

- DADO una grabación preexistente cuyo `recordingStorageKey` es null
- CUANDO delete/sign/download resuelve su clave
- ENTONCES usa `buildRecordingStorageKey()` (`${provider}/${meetingId}.mp4`), sin cambios

## Fuera de alcance

- **Envío de email real/automatizado** — `EmailProviderFactory` sigue siendo console/no-op; el Owner
  comparte los enlaces manualmente, igual que hoy.
- **Captura de Participant para reuniones sin calendario** — las reuniones ad-hoc nunca tienen lista
  sugerida.
- **Chequeo de ownership por reunión en `INVITE_BOT`/`STOP_BOT` de la extensión** — gap preexistente a
  cargo de la feature 008 (rama separada), no de este cambio.
- **Backfill de `recordingStorageKey`** para reuniones subidas antes de este cambio.
- **Transferencia de Owner / reasignación por admin** para las reuniones de un Owner desactivado — se
  vuelven inaccesibles, no se reasignan.

## Nota de migración

Las filas existentes de `meetings` y relacionadas son datos de prueba; esta migración va acompañada de
un reset de la DB, así que `ownerId NOT NULL` no necesita ningún camino de compatibilidad hacia atrás.
