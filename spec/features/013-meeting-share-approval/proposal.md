# Propuesta: Aprobación de Admin para Compartidos de Member + Proveedor SMTP de Email Real

ADRs fuente: `docs/adr/0004-smtp-email-provider.md`, `docs/adr/0008-member-share-admin-approval.md`.
Fuente de verdad del estado actual: `spec/features/013-meeting-share-approval/explore.md` (citado abajo
como `explore.md`). El vocabulario es canónico según `docs/CONTEXT.md` ("Meeting Ownership & Sharing"):
`Owner`, `Access Grant`, `Participant`, `Auto-Join Co-Attendee Grant`, `Share Request`.

## Intención

Dos ADRs aceptadas, una sola entrega:

- **Gap de email (ADR-0004)**: desde la feature 009, cada email "enviado" es en realidad un console log —
  `ConsoleEmailProvider` es la única implementación. Los links de compartido y los códigos OTP nunca
  llegan a una bandeja de entrada; el Owner copia los links a mano. Esto bloquea tanto el flujo
  `restricted_email` existente COMO cualquier flujo de aprobación que necesite notificar a alguien.
- **Gap de supervisión (ADR-0008)**: el negocio ahora exige que un Owner con rol `member` no pueda
  finalizar el compartido saliente por su cuenta. Propone; un `admin` de la plataforma aprueba o rechaza.
  Esto **revierte parcialmente la decisión #5 de ADR-0005** ("solo el Owner, sin excepciones"): la
  autoridad de compartido ahora se bifurca según `authorized_accounts.role`. Un Owner `admin` sigue
  compartiendo directamente, sin cambios.

## Alcance

### Dentro del Alcance
- **Modos de selección de destinatario (3)**: compartir con todos los `Participant`s / elegir entre
  `Participant`s / agregar un email que no está en la reunión. "Compartir con todos" es UI genuinamente
  nueva — la card actual es deliberadamente por-destinatario (`MeetingDetailsView.tsx:221-222`, según
  explore.md).
- **Tipos de acceso (3)**: `single_use` (solo destinatarios no registrados; muere en la primera
  verificación OTP `verifyAccess()` exitosa), `temporary` (el member elige libremente la cantidad de días
  al momento del request, con 15 precargado como valor por defecto — no fijo), `permanent` (por defecto
  para `Participant`s). Los destinatarios registrados nunca reciben `single_use` — `Access Grant` no
  tiene ningún evento de acceso de una sola vez.
- **Ciclo de vida del `Share Request`**: pending → approved | rejected | cancelled. Un request por
  destinatario, nunca agrupado. El `member` que creó un request pendiente puede cancelarlo él mismo. La
  aprobación crea exactamente la fila subsiguiente que definió ADR-0005 (`Access Grant` o
  `meeting_shares`) y dispara el email real; el rechazo no crea nada.
- **Autoridad de aprobación a nivel de plataforma**: cualquier `admin`, sin importar su asistencia a la
  reunión. Los admins aprueban o rechazan un `Share Request` exactamente como lo propuso el member
  (destinatario, tipo de acceso, cantidad de días) — los admins no editan el contenido de un request
  pendiente.
- **Superficie de notificación para admin**: campanita en el navbar + página dedicada de requests
  pendientes. Cuenta de no-leídos = cuenta global de requests pendientes; sin tracking de lectura por
  admin.
- **`SmtpEmailProvider`** (Nodemailer) vía el `EmailProviderFactory` existente. Fallback a console cuando
  falta configuración en local/dev; **producción falla de forma ruidosa y bloquea el envío** cuando falta
  configuración SMTP — nunca un "email" silencioso solo de console una vez desplegado. Tanto esta feature
  como el flujo `restricted_email` preexistente dependen de esto.

### Fuera del Alcance (rechazado deliberadamente durante el grill — no reintroducir)
- Cualquier cambio a la carrera de asignación/dedup de `Owner` de la feature 010/ADR-0007 (inserción
  única de `meetings(source_provider, source_event_id)`) — intacto.
- Estado de lectura de notificación por admin ("visto por X") — no-leído = pending, igual para todos los
  admins.
- Aviso de rechazo activo/push al `member` — solo descubrimiento pasivo, vía la lista de compartidos
  existente.
- Editar/reenviar un `Share Request` rechazado — el member crea uno nuevo.
- Que el admin edite el contenido de un `Share Request` pendiente antes de aprobar — solo
  aprobar/rechazar tal como fue propuesto.
- Acceso `single_use` para destinatarios registrados.
- Autoría de templates de email más allá de popular los campos existentes `SendEmailInput.text`/`html`.

## Capacidades (contrato para sdd-spec)

### Nuevas
- `share-request-approval`: ciclo de vida del Share Request, bifurcación member/admin, aprobación a
  nivel de plataforma.
- `admin-notifications`: campanita + página de requests pendientes, cuenta global de pendientes.
- `smtp-email-delivery`: provider SMTP real detrás del contrato `EmailProvider` existente.

### Modificadas
- `meeting-sharing` (comportamiento de 009): createShare/revokeShare y la creación de grants ganan la
  bifurcación por rol; la regla owner-only de ADR-0005 queda reemplazada para Owners `member`.

## Enfoque (alto nivel — el diseño completo es trabajo de sdd-design)

- **Email**: nuevo `SmtpEmailProvider implements EmailProvider`, seleccionado por `EMAIL_PROVIDER` en
  `EmailProviderFactory` (se reutiliza el factory; sin cambios en los callers — exactamente 2 call sites
  literales + 1 inyectado según explore.md). Agregar `nodemailer` solo a `apps/web/package.json`. Docs de
  env: `README.md` es el único target de sync real (no existen archivos `.env*.example` en el repo,
  según explore.md).
- **Bifurcación por rol**: extender el patrón de chequeo de owner existente en `meetingShareService.ts` /
  `meetingAccessGrantService.ts` con el chequeo ya idiomático `session.user.role !== "admin"` (hoy
  route-only, `admin/authorized-accounts/route.ts` — plomería nueva hacia actions/services, no un
  copy-paste). Sin ningún mecanismo de chequeo de admin nuevo.
- **Persistencia**: `Share Request` necesita nuevo estado pendiente persistido — hoy ni `meetingShares`
  ni `meetingAccessGrants` tienen una columna pending/approved/rejected. La forma exacta del schema
  (tabla nueva vs. columnas, modelado del tipo de acceso) es decisión de sdd-design.
- **UI**: los tres modos se adjuntan dentro de la card "Compartir reunión" existente; la campanita
  necesita un pequeño componente de nav compartido — hoy no existe ninguno, 3 páginas arman a mano
  headers duplicados (explore.md).
- **TDD (estricto, según AGENTS.md)**: cada cambio de service/chequeo de rol/transición de estado
  arranca en rojo en los paths espejo de `apps/__tests__/`; los tests de owner-gate existentes en
  `meeting-share-service.test.ts` / `meeting-access-grant-service.test.ts` ganan casos de bifurcación
  admin/member.

## Pregunta Abierta (marcada, NO resuelta acá)

- Los `Share Request`s rechazados para destinatarios **registrados** (camino Access Grant) no tienen
  ninguna superficie de UI existente donde renderizarse pasivamente — `MeetingDetailsView.tsx` no
  persiste ninguna lista de grants (explore.md L57-59). `sdd-design` debe decidir dónde vive el
  descubrimiento pasivo para ese camino.

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|------|------------|------------|
| La bifurcación por rol debilita el gate de owner de 009 (regresión de seguridad) | Media | TDD-first en ambas bifurcaciones; mantener `WebMeetingRepository.visibleToUser` (visibilidad) intacto — solo autoridad de compartido |
| Una mala configuración de SMTP rompe el flujo `restricted_email` existente | Baja | Fallback a console cuando falta configuración fuera de producción (requisito de ADR-0004) |
| Scope creep hacia features de notificación/estado de lectura | Media | Los non-goals listados arriba son contrato, no sugerencia |

## Plan de Rollback

- Feature branch → PR(s); revertir el/los merge commit(s) restaura el comportamiento owner-only. Las
  filas de `Share Request` pendientes quedan inertes sin el code path de aprobación (solo gatean la
  creación; nada corriente abajo las lee). SMTP vuelve al provider de console solo con la env
  `EMAIL_PROVIDER` — no se necesita revertir código.

## Criterios de Éxito

- [ ] El intento de compartido de un Owner `member` crea un `Share Request` pendiente (uno por
  destinatario); un Owner `admin` comparte directamente, sin cambios.
- [ ] Cualquier admin de la plataforma puede aprobar/rechazar; la aprobación crea la fila de grant/share
  correcta y envía un email real; el rechazo no crea nada.
- [ ] El badge de la campanita es igual a la cuenta global de pendientes; la página admin dedicada lista
  los requests pendientes.
- [ ] `single_use` se ofrece solo para destinatarios no registrados; `temporary` tiene 15 días por
  defecto pero el member puede fijar cualquier cantidad de días; `permanent` es el default para
  participantes.
- [ ] Un `member` puede cancelar su propio `Share Request` pendiente; los admins aprueban/rechazan tal
  como fue propuesto, sin editar.
- [ ] Con la env de SMTP configurada, los compartidos `restricted_email` y los códigos OTP llegan por
  email real. En local/dev, la configuración faltante cae a console. En producción, la configuración
  faltante falla de forma ruidosa y bloquea el envío — nunca un "email" silencioso solo de console una
  vez desplegado.
- [ ] Toda la lógica nueva es test-first; las suites existentes en verde (`bun test apps/__tests__`).
