# 004 · Hardening de RLS en tablas del schema public

**Estado:** propuesta

## Qué hace

Habilita Row Level Security (RLS) **sin políticas** (deny-by-default) en las 6 tablas del schema `public`
que hoy lo tienen deshabilitado: `chat_messages`, `meetings`, `users`, `settings`, `meeting_shares` y
`meeting_share_access_logs`. Con RLS activo y sin políticas, cualquier acceso vía la API pública de Supabase
(PostgREST, con la `anon key`) queda denegado por defecto, mientras que la aplicación —que conecta siempre
por `DATABASE_URL` con un rol que hace bypass de RLS— sigue leyendo y escribiendo exactamente igual que hoy.

El cambio se declara en el schema de Drizzle (`packages/shared/src/db/schema.ts`) y se materializa en una
migración versionada generada con `drizzle-kit generate`, de modo que sea reproducible en todos los ambientes
(local, dev-remote, producción). De paso corrige el drift de `authorized_accounts`, que ya tiene RLS activado
manualmente en dev-remote pero sin migración versionada que lo respalde.

## Por qué

El advisor de seguridad de Supabase marca esas 6 tablas en nivel **ERROR**: al estar expuestas por PostgREST
con la `anon key` pública y sin RLS, quedarían completamente abiertas a lectura/escritura si esa key se filtrara
o si un cliente futuro (extensión Chrome, un nuevo frontend) empezara a usar `@supabase/supabase-js` directo.
Hoy nadie consume estas tablas por PostgREST —toda la app va por Drizzle sobre `DATABASE_URL`—, pero la
superficie de ataque está abierta y es gratis cerrarla.

Está verificado en vivo que activar RLS no afecta a la app: el rol de conexión directa tiene `rolbypassrls = true`
y los roles de PostgREST (`anon`, `authenticated`, `authenticator`) tienen `rolbypassrls = false`. La prueba viva
es `authorized_accounts`, que ya opera con RLS activo (sin políticas) y la feature de team-role-management la lee
y escribe sin problemas vía Drizzle.

## Criterios de aceptación

_Condiciones verificables que deben cumplirse para dar la feature por terminada._

- [ ] Las 6 tablas (`chat_messages`, `meetings`, `users`, `settings`, `meeting_shares`,
      `meeting_share_access_logs`) tienen RLS habilitado tras aplicar la migración.
- [ ] El estado de RLS está declarado en `packages/shared/src/db/schema.ts` y respaldado por una migración
      versionada en `./drizzle/` generada con `drizzle-kit generate` (no aplicado a mano).
- [ ] La migración corrige el drift de `authorized_accounts`: su RLS queda reflejado en una migración
      versionada y es reproducible en un ambiente nuevo desde cero.
- [ ] El advisor de seguridad de Supabase deja de reportar esas 6 tablas en nivel ERROR por RLS deshabilitado.
- [ ] Existe un test de integración de regresión que confirma que Drizzle sigue pudiendo leer y escribir cada
      una de las 6 tablas después de habilitar RLS (red de seguridad ante una eventual pérdida de `bypassrls`),
      ubicado en `apps/__tests__/` según la convención de carpeta espejo.
- [ ] Ningún comportamiento de la aplicación (web, worker) cambia respecto a hoy: las operaciones existentes
      sobre esas tablas siguen funcionando sin intervención manual.

## Fuera de alcance

_Lo que esta feature NO incluye, para evitar que crezca._

- **Políticas granulares de acceso por fila** (`USING` / `WITH CHECK`): hoy ningún cliente consume estas
  tablas vía PostgREST/`anon key`, así que escribir políticas reales sería diseño especulativo (YAGNI) sin
  consumidor. Se documenta como upgrade path futuro: si algún día se usa `@supabase/supabase-js` del lado
  cliente, ahí sí harán falta políticas reales.
- Migrar la app a consumir Supabase vía PostgREST/`supabase-js` en lugar de Drizzle sobre `DATABASE_URL`.
- Cambios de RLS en cualquier tabla fuera de las 6 listadas (más allá de dejar versionado el
  `authorized_accounts` ya existente).
- Rotación o gestión de la `anon key` / claves de Supabase.
