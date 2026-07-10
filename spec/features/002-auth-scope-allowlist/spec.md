# 002 · Login con scope reducido + allowlist + super admin

**Estado:** propuesta

## Qué hace

El login sigue siendo con Google, pero deja de pedir permisos de Calendario en ese paso — solo pide
identidad básica (email, nombre, foto). El acceso a la aplicación queda restringido a una lista de
emails autorizados que gestiona un administrador; nadie se auto-registra. Un "super admin" (definido
por variable de entorno) existe desde el primer despliegue y puede dar de alta o baja a otros usuarios
desde Ajustes. Conectar el Calendario de Google (para el auto-join a reuniones) pasa a ser un paso
aparte y opcional dentro de Ajustes, ya no algo que ocurre automáticamente al iniciar sesión.

## Por qué

Hoy el login y el permiso de Calendario son el mismo flujo OAuth: se pide `calendar.readonly` con
`access_type: offline` y `prompt: consent` en cada inicio de sesión. Como `calendar.readonly` es un
scope sensible de Google y la pantalla de consentimiento no está verificada, Google muestra el
interstitial de "app no verificada" en **cada** login, no solo el primero — confuso para usuarios
internos de la empresa que no entienden por qué una herramienta interna les muestra esa advertencia.

Comparando con el proyecto hermano `auditcheck-auditoria-satocan` (que nunca muestra este warning):
la diferencia es que ese login pide únicamente los scopes por defecto (`openid email profile`), sin
tocar ninguna API sensible de Google. Esto confirma que la causa es el scope pedido en el login, no el
uso de Google como proveedor de identidad. Separar login de conexión de Calendario resuelve el problema
real sin necesitar una migración de arquitectura mayor (Supabase Auth, password propio).

Además, hoy cualquier cuenta de Google puede iniciar sesión y crear un usuario — no hay control de
acceso, lo cual no es apropiado para una herramienta interna de empresa.

**Nota importante — el warning de Google no desaparece del todo, se mueve**: el paso de "Conectar
Calendario" sigue pidiendo `calendar.readonly` (scope sensible), así que Google va a seguir mostrando
el interstitial de "app no verificada" ahí — una sola vez por usuario que decide conectar su Calendario,
ya no en cada login. Es un comportamiento esperado de Google, no un bug de esta feature. Documentado en
la UI (botón "Conectar Calendario" en Ajustes) para que no sorprenda al usuario. Eliminarlo del todo
requiere trabajo aparte en Google Cloud Console (branding correcto del consent screen + User Type
Internal si hay Google Workspace, o verificación completa de la app) — investigado previamente, ver
memoria `sdd/google-oauth-consent-warning/explore`.

## Criterios de aceptación

- [ ] Al iniciar sesión con Google, no se pide `calendar.readonly` ni `access_type: offline`; no aparece
      el warning de "app no verificada" en el login normal.
- [ ] Un email que no está en la allowlist de cuentas autorizadas (y no es un super admin configurado)
      no puede iniciar sesión; ve un mensaje claro de acceso no autorizado.
- [ ] Al desplegar, cada email listado en `SUPER_ADMIN_EMAILS` queda provisto automáticamente como
      administrador activo la primera vez que inicia sesión — sin pasos manuales en la base de datos.
- [ ] Todos los usuarios que ya podían iniciar sesión antes de este cambio (filas existentes en `users`)
      siguen pudiendo iniciar sesión después del deploy, sin intervención manual (backfill de la
      allowlist).
- [ ] Un administrador puede agregar o desactivar emails autorizados desde una sección de Ajustes.
- [ ] Un usuario puede conectar o desconectar su Google Calendar desde Ajustes, de forma independiente
      al login; el consentimiento de Calendario (`calendar.readonly`, acceso offline) solo se pide en
      ese paso explícito.
- [ ] El auto-join a reuniones sigue funcionando sin cambios para los usuarios que ya tenían el
      Calendario conectado antes de este cambio.

## Fuera de alcance

- Migrar a Supabase Auth o login con email+password propio — evaluado y descartado para este cambio;
  el problema reportado no lo requiere (ver `plan.md` → Decisiones).
- Roles más granulares que `admin` / `member`.
- Auto-registro de usuarios — el acceso siempre lo da de alta un administrador.
- Envío de emails de invitación — el alta es solo agregar el email a la allowlist, el usuario entra con
  su cuenta de Google existente, no hace falta mandarle nada.
- Eliminar por completo el warning de "app no verificada" de Google en el paso de Conectar Calendario —
  requiere branding del consent screen y/o verificación en Google Cloud Console, fuera del alcance de
  código de este cambio.
