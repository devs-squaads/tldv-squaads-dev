# 003 · Middleware de autenticación a nivel de página

**Estado:** implementado ✅

## Qué hace

Ninguna página del dashboard (`/`, `/settings`, `/meeting/:id`, `/new`, `/downloads/:slug`) se renderiza
para quien no tiene una `Session Auth` válida y activa — se lo redirige a `/login`. Al loguearse, vuelve
exactamente a la página que quería ver (no siempre al dashboard). `/login` deja de mostrarse a quien ya
tiene sesión activa: lo manda directo adentro. Los enlaces públicos de `/share/[token]` y toda la API
(`/api/*`) siguen exactamente igual que hoy — no se tocan.

## Por qué

Se descubrió navegando manualmente que **cualquier persona con la URL puede ver el dashboard completo**
(reuniones, transcripciones, resúmenes) sin haber iniciado sesión nunca — ninguna `page.tsx` ni ningún
`middleware.ts` chequea sesión, solo algunas rutas de API individuales lo hacen por su cuenta. El trabajo
de `002-auth-scope-allowlist` protegió el **botón de login** (quién puede entrar), pero nunca protegió
las **páginas en sí** (qué se puede ver sin entrar) — son capas distintas y esta feature cierra la que
quedó abierta.

Diseño resuelto con `/grill-with-docs` antes de esta spec — decisiones y vocabulario quedaron en
`docs/CONTEXT.md`, `docs/adr/0001-page-auth-middleware-deprecated-convention.md` (superseded)
y `docs/adr/0002-migrate-auth-gate-into-existing-proxy-ts.md` (decisión real, corregida en implementación).

## Criterios de aceptación

- [x] Visitar `/`, `/settings`, `/meeting/:id`, `/new` o `/downloads/:slug` sin `Session Auth` redirige a
      `/login` (no se renderiza ni un fragmento de la página protegida).
- [x] Visitar cualquiera de esas rutas con `Session Auth` válida y rol activo (`admin` o `member`) las
      renderiza normalmente, sin cambios respecto a hoy.
- [x] Loguearse desde `/login?callbackUrl=/settings` devuelve a `/settings` después del login, no al
      dashboard por defecto — salvo que `callbackUrl` no sea una ruta interna válida, en cuyo caso cae a `/`.
- [x] Visitar `/login` teniendo ya `Session Auth` activa redirige automáticamente (a `callbackUrl` si
      venía en la URL, si no a `/`) sin mostrar el formulario.
- [x] `/share/[token]` sigue siendo accesible sin sesión, exactamente igual que antes (`Public Route`).
- [x] Ninguna ruta bajo `/api/*` cambia de comportamiento — siguen protegiéndose (o no) exactamente como
      hoy, el middleware nuevo no las toca.
- [x] Un `token` de sesión con `role` vacío/inexistente (cuenta desactivada desde "Equipo") no alcanza
      para ver páginas protegidas, aunque la cookie siga presente.

## Fuera de alcance

- Restricciones de página por rol específico (ej. una página exclusiva de `admin`) — hoy no existe
  ninguna, y `SettingsView.tsx` ya oculta la sección "Equipo" a nivel UI para `member`; no se toca.
- Cualquier cambio a rutas de API — ya se protegen (o no) por su cuenta y quedan afuera a propósito
  (ver `plan.md` → Decisiones).
- Refrescar el rol del JWT en tiempo real dentro del propio middleware (requeriría ir a la DB en el Edge
  runtime) — se acepta el mismo margen de latencia que ya existe hoy vía el refresco de `useSession()`.
- Eliminar `apps/web/src/proxy.ts` o migrar a la convención `proxy.ts`/`middleware.ts` de otra forma —
  ya no aplica: la implementación real terminó migrando la lógica al `proxy.ts` existente (ver
  `docs/adr/0002-migrate-auth-gate-into-existing-proxy-ts.md`), al descubrirse que Next.js 16 no permite
  que coexistan ambos archivos.
