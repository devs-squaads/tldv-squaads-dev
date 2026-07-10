# 003 · Middleware de autenticación a nivel de página — Tareas

_Checklist accionable derivada del `plan.md`. Tareas pequeñas y concretas; marca `[x]` al completarlas._
_Orden TDD (RED → GREEN → REFACTOR): primero el test que falla, luego el código mínimo que lo pasa. Tests en `apps/__tests__/<app>/<área>/` (ver `../../constitution/tech-stack.md` → Testing)._

## Guard de autorización (unidades puras)

- [x] Test: `isAuthorizedToken` devuelve `false` para `null`/`undefined` y para un token sin `role` (RED).
- [x] Test: `isAuthorizedToken` devuelve `true` para un token con `role: "admin"` o `role: "member"` (RED).
- [x] Test: `isPublicPagePath` devuelve `true` para `/login` y para `/share/algo`, `false` para `/`,
      `/settings`, `/downloads/x` (RED).
- [x] Implementación: `apps/web/src/lib/pageAuthGuard.ts` con ambas funciones (GREEN).

## Redirect de login (unidad pura)

- [x] Test: `resolveLoginRedirect` devuelve el valor si empieza con `/` simple (ej. `/settings`) (RED).
- [x] Test: `resolveLoginRedirect` devuelve `"/"` para `null`, string vacío, `//evil.com`, o una URL con
      esquema (`https://evil.com`) (RED).
- [x] Implementación: `apps/web/src/lib/loginRedirect.ts` (GREEN).

## Gate en `proxy.ts` (corregido — ver ADR 0002)

_Se descubrió que `apps/web/src/proxy.ts` ya existía con un gate naive (solo chequea presencia de cookie,
no la valida), y que Next.js 16 no permite que coexistan `middleware.ts` y `proxy.ts` (falla el build,
prioriza `proxy.ts`). El `middleware.ts` creado en el intento anterior se elimina; la lógica se migra a
`proxy.ts`._

- [x] Eliminar `apps/web/src/middleware.ts`.
- [x] Implementación: reescribir `apps/web/src/proxy.ts` para usar `withAuth` (exportado como `export
      const proxy = withAuth(...)`), `matcher` excluyendo `/api`, `_next/static`, `_next/image`,
      `favicon.ico` (reemplaza la lista manual de prefijos públicos); `authorized` callback usando
      `isPublicPagePath` + `isAuthorizedToken`; comentario apuntando a
      `docs/adr/0002-migrate-auth-gate-into-existing-proxy-ts.md` (validación por integración manual — el
      gate en sí no es fácilmente unit-testeable sin un request real de Next.js; la lógica que decide
      queda cubierta por los tests de arriba).
- [x] Verificación: `bun run --cwd apps/web build` completa sin el error "Both middleware file and proxy
      file are detected" (no alcanza con `typecheck`, hay que correr el build real).

## Página de login

- [x] Implementación: `login/page.tsx` lee `callbackUrl` de `useSearchParams()`, lo pasa por
      `resolveLoginRedirect` antes de `signIn("google", { callbackUrl })`.
- [x] Implementación: `login/page.tsx` agrega `useSession()` + `useEffect` que redirige
      (`router.replace(resolveLoginRedirect(callbackUrl))`) cuando `status === "authenticated"`.

## Fix encontrado en verificación manual (no estaba en el checklist original)

_`sdd-verify` marcó como WARNING que `login/page.tsx` podía mostrar el form brevemente a alguien ya
autenticado, por falta de `session` inicial en `SessionProvider`. Al probar `/login` contra un dev
server real para confirmarlo, se encontró que en realidad **la página tiraba 500** — `AuthProvider`
solo envolvía `(main)/layout.tsx`, y `/login` queda fuera de ese grupo de rutas, así que el nuevo
`useSession()` de `login/page.tsx` no tenía ningún `SessionProvider` ancestro. Ni el `apply` ni el
`verify` automatizados lo detectaron porque ninguno corrió un dev server real._

- [x] Fix: mover `AuthProvider` de `(main)/layout.tsx` al `app/layout.tsx` raíz, fetcheando la sesión
      server-side (`getServerSession(authOptions)`) y pasándola como prop inicial a `SessionProvider`
      — arregla el 500 de `/login` y de paso el WARNING del flash del form.
- [x] Verificado con dev server real: `/login` → 200; `/` sin sesión → 307 a `/login?callbackUrl=%2F`;
      `/share/token-de-prueba` → 200 sin redirect; `bun test`/`typecheck`/`lint` sin regresiones.

## Validación e integración

- [x] Validación manual: visitar `/`, `/settings`, `/meeting/:id`, `/new`, `/downloads/x` sin sesión →
      las 5 dan `307` a `/login?callbackUrl=<ruta original>` (verificado con `curl` contra dev server real).
- [x] Validación manual: loguearse desde un link con `?callbackUrl=/settings` → termina en `/settings`,
      no en `/`. Confirmado por el usuario con login real de Google. (En el camino se encontró y corrigió
      un `redirect_uri_mismatch` en Google Cloud Console — no relacionado con esta feature, causado por
      una URI de redirect mal registrada; ya corregido por el usuario.)
- [x] Validación manual: con sesión activa, navegar a `/login` a mano → redirige solo, no muestra el form.
      Confirmado por el usuario.
- [x] Validación manual: `/share/[token]` sigue siendo `200` sin sesión (verificado con `curl`).
- [x] Validación manual: las rutas de API siguen igual — `calendar-toggle` da `401` real (no redirect),
      `google-credentials` sigue `200` sin auth, `/api/auth/session` sigue `200` (verificado con `curl`).
- [x] Validar contra los criterios de aceptación de `spec.md` — los 7 criterios confirmados (5 por
      `curl` contra dev server real, 2 por login real de Google del usuario).
- [ ] Actualizar `README.md` si el flujo de login/redirect documentado ahí queda desactualizado.
- [ ] Mover la feature a "Hecho" en `../../constitution/roadmap.md`.
