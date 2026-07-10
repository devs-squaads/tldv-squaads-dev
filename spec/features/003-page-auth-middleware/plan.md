# 003 · Middleware de autenticación a nivel de página — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

**Corrección post-implementación (ver ADR 0002):** `apps/web/src/proxy.ts` **ya existía** con un gate
propio naive (solo chequea presencia de la cookie de sesión, no la valida). Se descubrió recién al
correr un build real, que además falla si además existe `middleware.ts` — Next.js 16 no permite los dos
archivos a la vez y prioriza `proxy.ts`. El enfoque real es: migrar la lógica a `proxy.ts` (reemplazando
su chequeo naive), sin crear ningún `middleware.ts`.

Se envuelve `withAuth` de `next-auth/middleware` (NextAuth v4) dentro de `proxy.ts`, exportado como
`export const proxy = withAuth(...)` (el nombre del export es lo único que le importa a la convención de
Next.js; la función interna funciona igual sin importar el nombre de archivo/export). `matcher` excluye
`/api`, `_next/static`, `_next/image` y `favicon.ico` — el mismo patrón que documentan los ejemplos
oficiales de NextAuth v4 y v5, en vez de la lista manual de prefijos públicos que tenía la versión vieja.
Dentro del árbol de páginas, el `authorized` callback deja pasar `/login` y `/share/*` sin exigir token,
y para el resto exige `!!token?.role`. La lógica de "a dónde vuelvo después de loguear" y "ya tengo
sesión, sacame de /login" vive en `login/page.tsx`, no en `proxy.ts`, porque son decisiones de UI de una
sola página, no de gateo de acceso.

## Implementación

1. `apps/web/src/lib/pageAuthGuard.ts` (nuevo) — exporta `isAuthorizedToken(token)` (pura: `!!token &&
   !!token.role`) y `isPublicPagePath(pathname)` (pura: `true` para `/login` y `/share/...`). Ambas
   testeables sin mockear Next.js.
2. `apps/web/src/proxy.ts` (modificar el existente, NO crear `middleware.ts`) — reemplazar el chequeo
   manual de cookie por `withAuth` con `callbacks.authorized: ({ token, req }) =>
   isPublicPagePath(req.nextUrl.pathname) || isAuthorizedToken(token)`, `pages: { signIn: "/login" }`,
   `export const config = { matcher: [...] }` ajustado para excluir `/api` completo. No importa `@/auth`
   ni `authOptions` completo — solo necesita `NEXTAUTH_SECRET`, que `getToken`/`withAuth` leen de
   `process.env` automáticamente. Esto evita arrastrar código de DB (Drizzle/repositorios) al bundle.
3. `apps/web/src/lib/loginRedirect.ts` (nuevo) — exporta `resolveLoginRedirect(callbackUrl: string |
   null): string`: si `callbackUrl` empieza con `/` y no con `//` (evita open redirect a otro origen),
   lo devuelve tal cual; si no, devuelve `"/"`.
4. `apps/web/src/app/login/page.tsx` (modificar) — lee `callbackUrl` con `useSearchParams()`, lo pasa a
   `signIn("google", { callbackUrl: resolveLoginRedirect(callbackUrl) })`; agrega `useSession()` +
   `useEffect` que, si `status === "authenticated"`, hace `router.replace(resolveLoginRedirect(callbackUrl))`.
5. Verificación obligatoria con `bun run --cwd apps/web build` (no solo `typecheck`) — es la única forma
   de detectar un conflicto real de convención `middleware.ts`/`proxy.ts` como el que motivó esta corrección.

## Decisiones

- **Migrar a `proxy.ts` existente, no crear `middleware.ts`** — decisión original (ADR 0001) descartada
  al confirmar con un build real que Next.js 16 no permite ambos archivos y prioriza `proxy.ts`. Detalle
  completo en `docs/adr/0001-...` (superseded) y `docs/adr/0002-migrate-auth-gate-into-existing-proxy-ts.md`.
- **Matcher excluye `/api` por completo** — las rutas de API de este proyecto ya se protegen solas
  (`getServerSession` por ruta, confirmado en vivo con `calendar-toggle` devolviendo 401 real). Meterlas
  en el middleware sumaría la complejidad de decidir 401-JSON vs redirect-HTML sin arreglar nada roto.
  Coincide con el patrón de todos los ejemplos oficiales de NextAuth (v4 y v5).
- **`authorized` exige `!!token?.role`, no solo `!!token`** — consistente con cómo ya autorizan las
  rutas API existentes. Implica que una cuenta desactivada desde "Equipo" puede tardar hasta el próximo
  refresco de `useSession()` en perder acceso a nivel página (no instantáneo como sí lo es en las rutas
  API, que llaman `getServerSession` directo). Aceptado explícitamente — no es peor que el comportamiento
  actual de la sesión JWT en ningún otro punto del sistema.
- **`/downloads/[slug]` queda protegido, no excluido** — hoy no tiene ningún auth check propio (solo
  compara el nombre del archivo). El flujo de onboarding documentado (`README.md` → "Distribución interna
  y onboarding seguro") ya exige login previo para generar el link-token de la extensión, así que exigir
  sesión acá no rompe nada y cierra un segundo gap encontrado de paso.
- **Redirect post-login y redirect-si-ya-autenticado viven en `login/page.tsx`, no en el middleware** —
  meterlo en el `authorized` callback del middleware exigiría lógica de redirect condicional por path
  dentro de `withAuth`, más compleja y menos testeable que una función pura en la página. Ponytail: la
  solución más simple que cumple el requisito es la correcta acá.
- **No se reinventa la protección contra open redirect de `callbackUrl` para el `signIn()` de Google** —
  NextAuth v4 ya tiene un callback `redirect` por defecto que solo permite URLs del mismo origin; como
  `authOptions` no lo sobreescribe, ese chequeo ya existe para el flujo de login real. `resolveLoginRedirect`
  sí hace falta aparte para el caso "ya autenticado, saco a la persona de `/login`" porque ese `router.replace`
  es un redirect de cliente puro, fuera del pipeline de NextAuth, sin esa protección incorporada.

## Riesgos

- **Staleness del rol en el JWT del middleware** — ver Decisiones arriba. Mitigación: ya existe (el
  refresco de `useSession()` en el cliente), no se agrega nada nuevo, solo se documenta el límite.
- **`NEXTAUTH_SECRET` ausente en algún entorno** — si no está seteada, `auth.ts` cae a un string fijo de
  desarrollo (`squaads-dev-secret-change-in-production`) para firmar tokens, pero `getToken`/`withAuth`
  en el middleware no conocen ese fallback si no está en `process.env.NEXTAUTH_SECRET` explícitamente.
  Mitigación: no se introduce código nuevo para esto — `NEXTAUTH_SECRET` ya es una variable documentada y
  requerida en los tres entornos desde `002-auth-scope-allowlist`; se deja como supuesto explícito, no se
  duplica el fallback en el middleware para no ocultar el error si algún entorno la pierde.
- **Futuro diseño de gating asuma que no existe ningún archivo previo** — mitigación: comentario corto en
  el propio `proxy.ts` apuntando a `docs/adr/0002-...`; lección explícita en el ADR 0002 de buscar ambos
  nombres de archivo antes de asumir que no hay gate previo.
