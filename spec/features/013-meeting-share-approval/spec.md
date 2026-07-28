# 013 · Aprobación de Admin para Compartidos de Member + Proveedor SMTP de Email Real

**Estado:** spec (proposal confirmed)

## Propósito

El compartir saliente DEBE ganar supervisión: un `Owner` cuyo rol de `Authorized Account` es `member`
propone un **Share Request**; cualquier `admin` de la plataforma lo aprueba o rechaza, y solo la
aprobación crea la fila real de `Access Grant`/`meeting_shares` y envía un email real. Un `Owner` cuyo rol
es `admin` comparte directamente, sin cambios. De forma independiente, el email DEBE dejar de ser un
console log: un `SmtpEmailProvider` real entrega los links de compartido y los códigos OTP.

El vocabulario de dominio está fijado por `docs/CONTEXT.md` ("Meeting Ownership & Sharing"): **Owner**,
**Access Grant**, **Participant**, **Auto-Join Co-Attendee Grant**, **Share Request**. Este spec usa esos
términos exactos — sin sinónimos. ADRs fuente: `docs/adr/0004-smtp-email-provider.md`,
`docs/adr/0008-member-share-admin-approval.md`.

## MODIFIED Requirements (reemplaza la feature 009)

### Requirement: Autoridad de compartido bifurcada por rol

Solo el `Owner` de una reunión PUEDE iniciar el compartido o la revocación de esa reunión; el rol NO DEBE
otorgarle autoridad de compartido a un no-Owner. Cuando el `role` de `authorized_accounts` del `Owner` es
`admin`, la fila de `Access Grant` / `meeting_shares` DEBE crearse directamente, exactamente como
especificó la feature 009. Cuando es `member`, el sistema DEBE crear un `Share Request` pendiente en su
lugar y NO DEBE crear ninguna fila subsiguiente ni enviar ningún email hasta que un `admin` lo apruebe.
(Anteriormente: ADR-0005/009 exigía Owner-only sin bifurcación por rol — "solo el Owner, sin
excepciones".)

#### Scenario: El Owner admin comparte directamente

- DADO el `Owner` O de la reunión M con `role = admin`
- CUANDO O comparte M con cualquier destinatario
- ENTONCES la fila de `Access Grant` (registrado) o `meeting_shares` (no registrado) se crea de
  inmediato
- Y no se crea ningún `Share Request`

#### Scenario: El Owner member siempre pasa por un Share Request

- DADO el `Owner` O de la reunión M con `role = member`
- CUANDO O comparte M con cualquier destinatario, por cualquier modo de selección de destinatario
- ENTONCES se crea un `Share Request` pendiente y todavía no existe ninguna fila de
  `Access Grant`/`meeting_shares`
- Y no se envía ningún email

#### Scenario: Un no-Owner sigue siendo rechazado sin importar el rol

- DADO un usuario autenticado X que no es el `Owner` de M, con `role = admin` o `member`
- CUANDO X intenta compartir o revocar sobre M
- ENTONCES la operación DEBE ser rechazada (un `admin` actúa solo sobre un `Share Request` existente)

#### Scenario: La visibilidad de la reunión no se ve afectada

- DADO el usuario A con `role = admin` que ni es dueño de M ni tiene un `Access Grant` vigente
- CUANDO A lista o abre M
- ENTONCES el acceso DEBE seguir siendo denegado (la regla de visibilidad sin bypass de rol de 009 queda
  intacta)

## ADDED Requirements

### Requirement: Modos de selección de destinatario

La superficie de compartido DEBE ofrecer exactamente tres modos de selección de destinatario: (a) todos
los `Participant`s de la reunión, (b) un subconjunto elegido de `Participant`s, (c) una dirección de
email que no está presente en la reunión. Cada modo DEBE resolver a un destinatario por unidad saliente
— el modo (a) DEBE expandirse en un `Share Request` (o una fila directa, para un `Owner` `admin`) por
`Participant`, nunca un registro agrupado.

#### Scenario: Compartir con todos los participantes se expande por destinatario

- DADO la reunión M con 3 `Participant`s y un `Owner` `member`
- CUANDO el `Owner` selecciona "todos los participantes" y confirma
- ENTONCES se crean 3 `Share Request`s pendientes, uno por destinatario

#### Scenario: Selección de subconjunto

- DADO la reunión M con 3 `Participant`s
- CUANDO el `Owner` selecciona 2 de ellos y confirma
- ENTONCES exactamente 2 destinatarios son procesados y el `Participant` no seleccionado no recibe nada

#### Scenario: Email que no está en la reunión

- DADO la reunión M y una dirección de email que no es `Participant`
- CUANDO el `Owner` la ingresa y confirma
- ENTONCES se procesa como un único destinatario, resuelto como registrado (`Access Grant`) o no
  registrado (`meeting_shares`) por la misma regla que ya aplica la feature 009

### Requirement: Tipos de acceso y valores por defecto

El sistema DEBE soportar tres tipos de acceso por destinatario: `single_use`, `temporary` y `permanent`.
`single_use` DEBE ofrecerse SOLO para destinatarios no registrados (camino `meeting_shares`) y DEBE
volverse inutilizable en la primera verificación OTP `verifyAccess()` exitosa. `temporary` DEBE permitir
que el `Owner` solicitante fije cualquier cantidad de días, con 15 días precargados como valor por
defecto en lugar de fijo. `permanent` DEBE ser el tipo de acceso por defecto para `Participant`s.

#### Scenario: single_use muere en la primera verificación exitosa

- DADO un compartido `single_use` para un destinatario no registrado
- CUANDO el destinatario completa `verifyAccess()` de OTP exitosamente por primera vez
- ENTONCES el compartido se vuelve inutilizable para cualquier intento de acceso posterior

#### Scenario: single_use no se ofrece a destinatarios registrados

- DADO un email de destinatario que coincide con un `users.email` registrado
- CUANDO se presentan las opciones de tipo de acceso
- ENTONCES `single_use` NO DEBE ser seleccionable, y solo `temporary` o `permanent` están disponibles

#### Scenario: La cantidad de días de temporary es editable, no fija

- DADO que el `Owner` selecciona `temporary`
- CUANDO se presenta el campo de cantidad de días
- ENTONCES viene precargado con 15
- Y el `Owner` PUEDE cambiarlo a cualquier otra cantidad de días válida, que es el valor que se lleva al
  request

#### Scenario: permanent es el valor por defecto para participantes

- DADO un `Participant` seleccionado como destinatario
- CUANDO el tipo de acceso no se cambia explícitamente
- ENTONCES el tipo de acceso usado es `permanent`

### Requirement: Ciclo de vida del Share Request

Un `Share Request` DEBE persistir exactamente un destinatario con su tipo de acceso y cantidad de días
propuestos, y DEBE ocupar exactamente uno de los estados `pending`, `approved`, `rejected`, `cancelled`.
Las únicas transiciones legales son `pending -> approved`, `pending -> rejected` y `pending -> cancelled`.
La aprobación DEBE crear la fila subsiguiente que ya define la feature 009 (`Access Grant` para
destinatarios registrados, `meeting_shares` para los no registrados) y DEBE disparar el email real. El
rechazo y la cancelación NO DEBEN crear nada. El `member` que creó un `Share Request` pendiente PUEDE
cancelarlo; nadie más PUEDE.

#### Scenario: La aprobación crea la fila subsiguiente y envía el email

- DADO un `Share Request` pendiente para un destinatario no registrado con `temporary`, 15 días
- CUANDO un `admin` lo aprueba
- ENTONCES el request pasa a `approved`, se crea una fila de `meeting_shares` con una expiración de 15
  días
- Y el destinatario recibe un email real con el link de compartido

#### Scenario: El rechazo no crea nada

- DADO un `Share Request` pendiente
- CUANDO un `admin` lo rechaza
- ENTONCES el request pasa a `rejected` y no existe ninguna fila de `Access Grant`/`meeting_shares`
- Y no se envía ningún email al destinatario

#### Scenario: El autor cancela su propio request pendiente

- DADO un `Share Request` pendiente creado por el `Owner` `member` O
- CUANDO O lo cancela
- ENTONCES pasa a `cancelled` y no se crea ninguna fila subsiguiente

#### Scenario: Un request resuelto no puede transicionar de nuevo

- DADO un `Share Request` que ya está en `approved`, `rejected` o `cancelled`
- CUANDO cualquier actor intenta aprobarlo, rechazarlo o cancelarlo
- ENTONCES la operación DEBE ser rechazada y el estado NO DEBE cambiar

#### Scenario: Solo el autor puede cancelar

- DADO un `Share Request` pendiente creado por el `Owner` `member` O
- CUANDO otro `member` o un `admin` intenta cancelarlo
- ENTONCES la operación DEBE ser rechazada

### Requirement: Autoridad de aprobación admin a nivel de plataforma

Cualquier `Authorized Account` con `role = admin` DEBE poder aprobar o rechazar CUALQUIER `Share Request`
pendiente, sin importar si ese admin es `Participant`, `Owner` o grantee de la reunión. Los admins DEBEN
aprobar o rechazar un `Share Request` exactamente como fue propuesto — el destinatario, el tipo de acceso
y la cantidad de días NO DEBEN ser editables por quien aprueba. Un no-admin NO DEBE aprobar ni rechazar.

#### Scenario: Un admin sin relación con la reunión puede decidir

- DADO el `admin` A que no es el `Owner`, no es `Participant`, y no tiene ningún `Access Grant` sobre M
- CUANDO A aprueba un `Share Request` pendiente sobre M
- ENTONCES la aprobación tiene éxito y la fila subsiguiente se crea tal como fue propuesta

#### Scenario: Un no-admin no puede decidir

- DADO un `member` (incluyendo al propio autor del request)
- CUANDO intenta aprobar o rechazar un `Share Request` pendiente
- ENTONCES la operación DEBE ser rechazada

#### Scenario: La decisión es tal como fue propuesta

- DADO un `Share Request` pendiente para el destinatario R con `temporary`, 30 días
- CUANDO un `admin` lo aprueba
- ENTONCES la fila creada usa al destinatario R con una expiración de 30 días, sin modificar

### Requirement: Rechazo silencioso con descubrimiento pasivo

El rechazo DEBE ser silencioso: el sistema NO DEBE capturar ni exigir un motivo de rechazo, y NO DEBE
empujar ninguna notificación activa (email o in-app) al `member` solicitante. El `member` DEBE poder
descubrir el resultado de forma pasiva: para un destinatario no registrado, vía la lista de compartidos
existente de la reunión; para un destinatario registrado, vía la nueva sección "Solicitudes y accesos"
(resolución de `sdd-design` — una lista de `Share Request` que cubre todos los estados, más una lista de
grants, ambas dentro de la card "Compartir reunión" existente en `MeetingDetailsView`).

#### Scenario: Sin aviso activo al member

- DADO un `Share Request` pendiente creado por el `member` O
- CUANDO un `admin` lo rechaza
- ENTONCES no se entrega ningún email ni notificación in-app a O
- Y no se solicita ni persiste ningún campo de motivo de rechazo

#### Scenario: El member ve el resultado de forma pasiva (destinatario no registrado)

- DADO un `Share Request` rechazado para un destinatario no registrado en la reunión M
- CUANDO O vuelve a abrir la superficie de compartido de M
- ENTONCES el estado rechazado es visible en la lista de compartidos existente de la reunión sin ninguna
  notificación

#### Scenario: El member ve el resultado de forma pasiva (destinatario registrado)

- DADO un `Share Request` rechazado para un destinatario registrado (camino `Access Grant`) en la
  reunión M
- CUANDO O vuelve a abrir la superficie de compartido de M
- ENTONCES el estado rechazado es visible en la nueva sección "Solicitudes y accesos" (lista de requests
  con todos los estados + lista de grants, según `sdd-design`) sin ninguna notificación

### Requirement: Superficie de notificación para admin

La aplicación DEBE exponer una campanita de notificación en el navbar de cada página autenticada y una
página dedicada que liste los `Share Request`s pendientes, ambas visibles solo para cuentas `admin`. El
badge de la campanita DEBE ser igual a la cuenta GLOBAL de `Share Request`s en estado `pending`. El
sistema NO DEBE trackear estado de lectura por admin — la cuenta es idéntica para cada admin y disminuye
para todos ellos en el momento en que cualquier admin resuelve un request.

#### Scenario: El badge es igual a la cuenta global de pendientes

- DADO 4 `Share Request`s pendientes entre cualquier reunión y cualquier autor
- CUANDO cualquier `admin` carga una página autenticada
- ENTONCES el badge de la campanita muestra 4

#### Scenario: La resolución decrementa la cuenta para todos los admins

- DADO 4 requests pendientes y los admins A y B
- CUANDO A aprueba uno
- ENTONCES el badge de B muestra 3 sin que B haya tomado ninguna acción

#### Scenario: La página de pendientes es admin-only

- DADO un usuario autenticado con `role = member`
- CUANDO carga la página de requests pendientes
- ENTONCES el acceso DEBE ser denegado y la campanita NO DEBE renderizarse para él

### Requirement: Entrega de email SMTP real con fallback dividido por entorno

Un `SmtpEmailProvider` que implementa el contrato `EmailProvider` existente DEBE ser seleccionable a
través del `EmailProviderFactory` existente vía `EMAIL_PROVIDER`, sin que se requiera ningún cambio en
ningún call site existente. Cuando la configuración SMTP falta o está incompleta: fuera de producción el
provider DEBE caer a console logging para que local/dev siga funcionando; en producción DEBE fallar de
forma ruidosa Y bloquear el envío — un envío de producción NUNCA DEBE degradarse silenciosamente a un
"email" solo de console.

#### Scenario: SMTP configurado entrega un email real

- DADO configuración SMTP completa y `EMAIL_PROVIDER` seleccionando SMTP
- CUANDO se envía un link de compartido `restricted_email` o un código OTP
- ENTONCES se entrega vía SMTP a la bandeja de entrada real del destinatario

#### Scenario: La configuración faltante en local/dev cae a console

- DADO configuración SMTP incompleta fuera de producción
- CUANDO se intenta un envío
- ENTONCES el provider loguea en console y el flujo llamante continúa

#### Scenario: La configuración faltante en producción falla de forma ruidosa

- DADO configuración SMTP incompleta en producción
- CUANDO se intenta un envío
- ENTONCES el envío DEBE ser bloqueado con un error explícito y expuesto
- Y el mensaje NO DEBE escribirse en console como sustituto de la entrega

## Escenarios No-Objetivo (NO DEBEN suceder)

Cada uno refleja un ítem deliberadamente rechazado en la lista Out-of-Scope de la propuesta.

#### Scenario: La carrera de asignación de Owner queda intacta

- DADO dos creaciones concurrentes para el mismo `(sourceProvider, sourceEventId)`
- CUANDO esta feature se despliega
- ENTONCES el dedup por inserción única de ADR-0007 y el `ownerId` resultante se comportan exactamente
  igual que antes

#### Scenario: Sin tracking de lectura por admin

- DADO los admins A y B y un `Share Request` pendiente
- CUANDO A visualiza la página de requests pendientes
- ENTONCES no se persiste ningún estado de visto/leído por admin y el badge de B no cambia

#### Scenario: Sin edición ni reenvío de un request rechazado

- DADO un `Share Request` rechazado
- CUANDO su autor intenta editarlo o reenviarlo
- ENTONCES no existe tal acción; el autor DEBE crear un `Share Request` nuevo

#### Scenario: El admin no puede editar un request pendiente

- DADO un `Share Request` pendiente
- CUANDO un `admin` intenta cambiar su destinatario, tipo de acceso o cantidad de días
- ENTONCES no existe tal acción; solo aprobar y rechazar están disponibles

#### Scenario: Sin autoría de template de email más allá de los campos existentes

- DADO un `Share Request` aprobado
- CUANDO se envía el email
- ENTONCES solo popula los campos existentes `SendEmailInput.text`/`html`, sin ningún sistema de
  templating nuevo

## Resuelto por sdd-design

**Superficie de rechazo pasiva para destinatarios registrados** — resuelto: `MeetingDetailsView` gana
una nueva sección "Solicitudes y accesos" (lista de `Share Request` con todos los estados + una lista de
grants) dentro de la card "Compartir reunión" existente. Ver la tabla de archivos de `plan.md` (fila
`MeetingDetailsView.tsx`) y los dos escenarios "El member ve el resultado de forma pasiva" de arriba.

## Notas

- Docs de env: `README.md` es el único target de sync real para las nuevas variables `SMTP_*` — no
  existe ningún archivo `.env*.example` en este repo (contradiciendo la convención declarada en
  AGENTS.md).
- Toda la lógica nueva es test-first según AGENTS.md, en los paths espejo de `apps/__tests__/`.
