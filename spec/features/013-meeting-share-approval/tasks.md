# Tareas: Aprobación de Admin para Compartidos de Member + Proveedor SMTP de Email Real

## Pronóstico de Carga de Review

| Campo | Valor |
|---|---|
| Líneas cambiadas estimadas | ~1400-1900 (tabla nueva+repo+service+provider+3 componentes nuevos+1 componente modificado grande+7 archivos de wiring+~9 archivos de test) |
| Riesgo del presupuesto de 400 líneas | Alto |
| PRs encadenados recomendados | Sí |
| División sugerida | PR1 → PR2 → PR3 → PR5 → PR6, con PR4 (SMTP) ramificando en paralelo desde PR1 |
| Estrategia de entrega | ask-on-risk |
| Estrategia de cadena | feature-branch-chain (recomendada, pendiente de confirmación) |

Decisión necesaria antes de apply: Sí
PRs encadenados recomendados: Sí
Estrategia de cadena: feature-branch-chain
Riesgo del presupuesto de 400 líneas: Alto

### Unidades de Trabajo Sugeridas

| Unidad | Objetivo | PR | Comando de test focalizado | Runtime harness | Límite de rollback |
|---|---|---|---|---|---|
| 1 | Schema + migration + `MeetingShareRequestRepository` + `requireCaller()` | PR1 (base=tracker) | `bun test apps/__tests__/shared/repositories/meeting-share-request-repository.test.ts apps/__tests__/web/lib/session-caller.test.ts` | `bun run infra:reset` (se aplica la migración, race de índice único) | Revertir las adiciones a schema.ts, el archivo de migración, el repository, sessionCaller.ts |
| 2 | Ciclo de vida completo de `ShareRequestService` | PR2 (base=PR1) | `bun test apps/__tests__/web/services/share-request-service.test.ts` | N/A — lógica de service pura, repo mockeado | Revertir shareRequestService.ts + test |
| 3 | Bifurcación por rol en los services existentes + wiring de actions | PR3 (base=PR2) | `bun test apps/__tests__/web/services/meeting-share-service.test.ts apps/__tests__/web/services/meeting-access-grant-service.test.ts` | `bun run dev:web`: compartido de Owner member → fila pending, sin email | Revertir los parámetros callerRole, actions/shares.ts, grants.ts, shareRequests.ts |
| 4 | `SmtpEmailProvider` + factory + package.json | PR4 (base=PR1, en paralelo a PR2/3) | `bun test apps/__tests__/web/integrations/smtp-email-provider.test.ts` | `bun run dev:web` con env real de SMTP, enviar un email de prueba | Revertir SmtpEmailProvider.ts, el case del factory, la dependencia en package.json |
| 5 | AppHeader + PendingRequestsBell + página admin | PR5 (base=PR3) | Solo manual (UI, sin archivo de test según la Estrategia de Testing) | `bun run dev:web`: el admin ve campanita+badge, el member no, la página redirige al member | Revertir AppHeader.tsx, PendingRequestsBell.tsx, la página admin, AdminShareRequestsView.tsx, los 3 reemplazos de página |
| 6 | `MeetingDetailsView.tsx` 3 modos + tipo de acceso/días + "Solicitudes y accesos" + chat tool + README | PR6 (base=PR5) | Solo manual (UI) | `bun run dev:web` walkthrough completo: compartir todos/subconjunto/email, approve/reject, descubrimiento pasivo | Revertir el diff de MeetingDetailsView.tsx, definitions.ts, README.md |

## Fase 1: Schema y Repository
- [x] 1.1 `packages/shared/src/db/schema.ts`: agregar `shareRequestStatusEnum`, `shareRequestAccessTypeEnum`, tabla `meetingShareRequests` (CHECK grantee XOR email, 2 índices parciales únicos), `meetingShares.singleUse` — según la sección Schema de plan.md.
- [x] 1.2 `drizzle/NNNN_meeting_share_requests.sql`: migración aditiva que coincide con 1.1.
- [x] 1.3 RED+GREEN `packages/shared/src/repositories/MeetingShareRequestRepository.ts` (create/findById/listPending/countPending/listByMeetingId/resolve/cancel). Test `meeting-share-request-repository.test.ts` según la Estrategia de Testing de plan.md.

## Fase 2: Helper `requireCaller()`
- [x] 2.1 RED+GREEN `apps/web/src/lib/sessionCaller.ts`. Test `session-caller.test.ts` según la Estrategia de Testing de plan.md.
- [x] 2.2 Reemplazar los dos `requireCallerId()` duplicados en `app/actions/shares.ts` y `grants.ts` por `requireCaller()`.

## Fase 3: `ShareRequestService` (TDD)
- [x] 3.1 RED+GREEN `apps/web/src/services/shareRequestService.ts` (contrato según Interfaces de plan.md). Test `share-request-service.test.ts` — todos los casos según la fila de la Estrategia de Testing de plan.md (incluye las aserciones de gate de admin, no se necesita un test separado).

## Fase 4: Bifurcación por Rol en los Services Existentes
- [x] 4.1 RED+GREEN `meetingShareService.ts`: guard `callerRole?` (member lanza throw), persistencia de `singleUse` + revoke-on-first-verify en `verifyRestrictedAccess`. Extender `meeting-share-service.test.ts` según plan.md.
- [x] 4.2 RED+GREEN `meetingAccessGrantService.ts`: guard `callerRole?` (member lanza throw), mapeo accessType→TTL (permanent→noExpiry, temporary→days*1440). Extender `meeting-access-grant-service.test.ts` según plan.md.
- [x] 4.3 `integrations/sharing/types.ts`: `CreateShareInput.singleUse?: boolean`.
- [x] 4.4 `app/actions/shares.ts`, `grants.ts`: Owner member → `ShareRequestService`, Owner admin → creación directa; la revocación se mantiene directa para ambos roles.
- [x] 4.5 `app/actions/shareRequests.ts` (nuevo): actions de create/cancel/approve/reject/listByMeeting/listPending.

## Fase 5: `SmtpEmailProvider` (TDD)
- [x] 5.1 `apps/web/package.json`: agregar `nodemailer` + `@types/nodemailer` (dev).
- [x] 5.2 RED+GREEN `integrations/email/providers/SmtpEmailProvider.ts`: transport factory inyectable; config completa → send; incompleta+producción → throw (bloquea el envío); incompleta+dev → fallback a console. Test `smtp-email-provider.test.ts` según plan.md.
- [x] 5.3 `integrations/email/EmailProviderFactory.ts`: agregar el case `"smtp"`.

## Fase 6: Wiring de UI
- [x] 6.1 `components/AppHeader.tsx` (nuevo): extraer el header compartido de los 3 headers inline duplicados.
- [x] 6.2 `components/PendingRequestsBell.tsx` (nuevo): admin-only, badge = `countPending()`, con link a la página admin.
- [x] 6.3 Reemplazar los headers en `app/(main)/page.tsx`, `settings/page.tsx`, `meeting/[id]/page.tsx` por `AppHeader`; la página de meeting además obtiene grants + share requests hacia sus props. (El reemplazo del header se hace en este PR; la obtención de las props de grants+share-requests se difiere a PR6, que es el primer PR que cambia `MeetingDetailsView.tsx` para efectivamente consumir esas props nuevas — pasarlas antes sería data muerta sin superficie de test.)
- [x] 6.4 `app/(main)/admin/share-requests/page.tsx` (nuevo): `force-dynamic`; sin sesión → `/login`; non-admin → `/`.
- [x] 6.5 `components/AdminShareRequestsView.tsx` (nuevo): lista de pendientes, approve/reject.
- [x] 6.6 `components/MeetingDetailsView.tsx`: 3 modos de destinatario (all/subset/email), controles de tipo de acceso + días, estado pending/cancel para member, nueva sección "Solicitudes y accesos" (requests con todos los estados + lista de grants).

## Fase 7: Consciencia de Rol en la Chat Tool
- [x] 7.1 `integrations/chat/tools/definitions.ts`: `manage_meeting_share` pasa el rol del caller; el member recibe el error "requiere aprobación de admin".

## Fase 8: Docs
- [x] 8.1 `README.md`: agregar `SMTP_HOST/PORT/USER/PASS/FROM` + la fila `EMAIL_PROVIDER=smtp` a la tabla de env (único target de sync real, no existen archivos `.env*.example`). Adelantado a PR4 (Fase 5) porque documenta las variables de env nuevas de esa propia unidad — ver las notas de apply-progress.

## Fase 9: Verificación
- [x] 9.1 `bun test apps/__tests__` en verde en esta cadena de branches (tracker→PR1→PR2→PR3→PR5→PR6). [PR6: 426 pass / 0 fail. Nota: la Fase 5 (SMTP, PR4) vive en un branch paralelo separado `feat/013-04-smtp-provider` desde PR1, todavía no mergeado en esta cadena de PR6 — sus tests no forman parte de esta corrida; todavía necesita una decisión de rebase/merge antes de que la feature quede completa de punta a punta]
- [x] 9.2 `bun run lint && bun run typecheck && bun run build:web`. [PR6: las tres limpias/en verde, en esta cadena de branches]
- [ ] 9.3 Walkthrough manual (UI-visual exenta según AGENTS.md, según la fila "Exempt" de la Estrategia de Testing de plan.md): cuenta del badge de la campanita, guard admin-only de la página, 3 modos de destinatario, superficies de rechazo pasivo (ambos caminos de destinatario), envío SMTP real con env configurada. [Originalmente no ejecutado — sin browser en ese entorno; checklist entregado al orchestrator/usuario en el reporte de apply de PR6. **Actualización (misma sesión, después de escribir esta nota):** un humano probó en vivo desde entonces: el flujo de creación de compartido con los 3 modos de destinatario en rol member (todos los participantes/subconjunto/email manual), un envío SMTP real entregado a una bandeja de Gmail en vivo (confirmado recibido, el enlace funcionó), y los fixes de UI que salieron junto con esta feature (`InfoModal`/`ConfirmModal` reemplazando `alert`/`confirm` nativos, el fix de theming del `<select>`, emails/nombres de reunión resueltos en vez de ids crudos). **Todavía sin probar en vivo:** las acciones de aprobar/rechazar del admin, y un Owner con rol admin compartiendo directo (sin Share Request). El checkbox queda sin marcar — el walkthrough es genuinamente parcial, no está completo.]
