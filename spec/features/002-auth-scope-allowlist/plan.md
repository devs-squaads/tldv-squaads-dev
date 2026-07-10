# 002 · Login con scope reducido + allowlist + super admin — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

Reutilizar el NextAuth v4 ya existente (`apps/web/src/auth.ts`) sin sumar dependencias nuevas ni tocar
infraestructura (Docker, Supabase Auth). Tres cambios independientes:

1. Reducir el scope pedido en el login de Google.
2. Agregar un gate de allowlist + bootstrap de super admin en el callback `signIn`.
3. Mover el consentimiento de Calendario a un flujo OAuth propio, disparado desde Ajustes.

El patrón de allowlist (tabla de cuentas autorizadas + email de super admin por variable de entorno,
chequeado en `signIn`) es el mismo que ya funciona en producción en el proyecto hermano
`auditcheck-auditoria-satocan` (`modules/auth/infrastructure/auth.ts`) — se adapta, no se inventa de
cero.

## Implementación

1. **Schema + migración** (`packages/shared/src/db/schema.ts`): agregar tabla `authorizedAccounts`
   (`email` único, `role`: `admin` | `member`, `isActive`, `invitedBy`, timestamps). La migración de
   Drizzle incluye un backfill: inserta como `member` activo a todos los emails que ya existen hoy en
   `users`, para no bloquear a nadie que ya usa la app en dev/producción.
2. **`apps/web/src/auth.ts`**: en `GoogleProvider`, sacar `calendar.readonly`, `access_type: "offline"`
   y `prompt: "consent"` de `authorization.params`; dejar `prompt: "select_account"`. En el callback
   `signIn`, antes de hacer `upsertFromGoogle`, resolver el rol vía `AuthorizedAccountRepository`:
   - si el email está en `SUPER_ADMIN_EMAILS`, autoprovisionar como `admin` activo.
   - si no, buscar en `authorized_accounts`; si no existe o `isActive` es falso, devolver `false`
     (login rechazado).
   Los callbacks `jwt`/`session` propagan `role` a la sesión (igual patrón que Satocan).
3. **`packages/shared/src/repositories/AuthorizedAccountRepository.ts`** (nuevo): `findByEmail`,
   `upsert`, `setActive`, siguiendo el estilo de los repositorios existentes (`UserRepository`,
   `CalendarAccountRepository`).
4. **Conexión de Calendario, paso separado**:
   - `apps/web/src/app/api/settings/calendar-connect/route.ts` (GET): redirige a la URL de
     autorización de Google pidiendo `calendar.readonly` + `access_type: offline` +
     `prompt: consent`, solo para el usuario ya logueado.
   - `apps/web/src/app/api/settings/calendar-connect/callback/route.ts`: intercambia el `code`,
     guarda `googleAccessToken`/`googleRefreshToken`/`googleTokenExpiry` y pone `calendarEnabled: true`
     vía `CalendarAccountRepository` (reutiliza el mismo mecanismo de refresh que ya vive en
     `auth.ts`).
5. **Administración de la allowlist**:
   - `apps/web/src/app/api/admin/authorized-accounts/route.ts` (GET lista, POST alta).
   - `apps/web/src/app/api/admin/authorized-accounts/[email]/route.ts` (PATCH para desactivar).
   - Ambas protegidas: requieren `session.user.role === "admin"`.
6. **UI** (`apps/web/src/app/(main)/settings/page.tsx`): el botón de Calendario pasa a llamar a
   `calendar-connect` en vez de asumir que ya hay token; nueva sección "Equipo" (visible solo si
   `role === "admin"`) para listar/agregar/desactivar emails autorizados.
7. **Entorno**: agregar `SUPER_ADMIN_EMAILS` (emails separados por coma) a `.env.development`,
   `.env.development.remote`, `.env.production` y sus `.example`; documentar en `README.md`.

## Decisiones

- **Mantener Google + NextAuth v4 como identidad, no migrar a Supabase Auth** — el problema reportado
  (la barrera de Google) lo causa el scope sensible pedido en el login, no el proveedor de identidad;
  la comparación directa contra Satocan lo confirma. Se descartó la migración a Supabase Auth por ser
  un cambio de arquitectura mucho mayor (tocaría `docker-compose.yml`, requeriría migrar usuarios
  existentes) para resolver algo que no lo necesita.
- **Acceso vía allowlist en Postgres, sin password** — encaja con "herramienta interna de empresa";
  reutiliza un patrón ya validado en producción en un proyecto hermano en vez de inventar uno nuevo.
- **Super admin vía variable de entorno, no seed manual en la base** — garantiza que exista al menos
  un administrador desde el primer deploy, sin pasos manuales de DB.
- **Backfill de usuarios existentes en la misma migración que crea la tabla** — el proyecto ya está
  desplegado en dev y producción; sin esto, todos los usuarios actuales quedarían bloqueados el día
  del deploy.
- **Calendario como flujo OAuth propio, no vía `signIn("google")` de NextAuth** — NextAuth reemplazaría
  la sesión activa si se reusara para esto; un redirect+callback manual (con el mismo intercambio de
  tokens que ya existe) evita ese efecto secundario.

## Riesgos

- **Estado real de producción (aclarado durante la revisión)**: la web **nunca estuvo viva en
  Vercel** — se está corrigiendo recién su deploy correcto. El `worker` sí está en producción y
  funcionando. Consecuencia directa: **no hay usuarios reales con sesión en la web de producción
  todavía**, así que el riesgo de "bloquear usuarios existentes" de esta feature no aplica hoy a
  prod (sí puede aplicar a `dev`, donde el equipo ya probó login). Y el auto-join que corre hoy en
  producción depende 100% del modo Service Account del worker (`AUTO_JOIN_ENABLED`,
  `AUTO_JOIN_ORGANIZER_EMAILS`, `GOOGLE_SERVICE_ACCOUNT_JSON`/`_FILE`) — **esas variables se
  mantienen en `.env.prod`/`.env.prod.example`**, no se tocan; se vuelven prescindibles recién
  cuando la web esté viva y usuarios reales conecten su Calendario vía OAuth desde Ajustes.
- **Deploy no atómico** — igual de válido para cuando la web SÍ quede desplegada en Vercel: si el
  migration + `auth.ts` se despliegan sin `SUPER_ADMIN_EMAILS` seteada, nadie puede gestionar la
  allowlist hasta que se agregue la variable y alguien vuelva a loguearse. El `web` (donde vive
  `auth.ts`) corre en Vercel, deploy separado de los workflows de GitHub Actions de este repo (que
  solo despliegan el `worker` — `deploy.sh` + Docker sobre SSH); Vercel además no aplica en caliente
  los cambios de env vars a un deployment corriendo, requiere un redeploy para tomar efecto.
  Mitigación, en orden, **antes de que la web quede desplegada de verdad**:
  1. Agregar `SUPER_ADMIN_EMAILS` en Vercel → proyecto web → Settings → Environment Variables, en
     `Production` (y en el environment de `dev`/preview si existe uno propio).
  2. Agregar la misma variable a `.env.development` y `.env.development.remote` en local.
  3. Documentar en `.env.development.example`, `.env.production.example` y `README.md`.
  4. Recién entonces desplegar — el redeploy automático de Vercel ya la va a tomar desde el primer
     request. No requiere tocar `.github/workflows/*.yml`, `deploy.sh` ni `docker-compose*.yml`
     (esos solo gestionan el `worker`).
- **Refresh token de Calendario obtenido con el login viejo** — usuarios con `calendarEnabled: true` de
  antes siguen funcionando igual; si ese refresh token se revoca, ya no se renueva solo (antes,
  re-loguearse alcanzaba). Mitigación: usar el nuevo flujo de "Conectar Calendario" para renovarlo;
  documentarlo, es un caso poco frecuente.
- **Gate de allowlist mal implementado bloquea usuarios válidos** — cubrir con tests el caso
  "no autorizado", "bootstrap de super admin" y "usuario existente por backfill" antes de tocar código
  de producción.
- **Rol "congelado" en la sesión (encontrado en revisión, ya arreglado)** — con `strategy: "jwt"`, el
  callback `jwt` solo resolvía el rol en el login inicial; desactivar a alguien desde "Equipo" no tenía
  efecto hasta que esa sesión expirara (hasta 30 días por defecto) o la persona cerrara sesión — un
  ex-admin podía seguir con permisos de admin, incluida la capacidad de reactivarse a sí mismo. Arreglado:
  el rol se re-resuelve en cada llamada al callback `jwt` (no solo cuando hay `account`/`user`), y una
  cuenta con `isActive: false` pierde el rol elevado de inmediato en el siguiente request. Limitación
  residual conocida: esto cierra el hueco de escalación de admin, pero el acceso general a la app (para
  un `member` no-admin desactivado) no se re-verifica en cada request fuera de las rutas de admin — se
  mantiene hasta que esa sesión expire. Cerrar eso del todo requeriría un chequeo de `isActive` a nivel
  middleware para toda la app, fuera del alcance de este cambio.
- **Falta de protección CSRF (`state`) en el flujo de Calendar (encontrado en revisión, ya arreglado)** —
  el redirect a Google y su callback no vinculaban la ida con la vuelta. Arreglado: `calendar-connect`
  genera un `state` aleatorio, lo manda a Google y lo guarda en una cookie `httpOnly` de 10 minutos; el
  callback rechaza la conexión si el `state` recibido no coincide con la cookie.
