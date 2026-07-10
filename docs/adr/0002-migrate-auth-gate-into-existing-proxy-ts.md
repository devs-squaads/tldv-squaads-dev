# Migrar el gate de auth al `proxy.ts` ya existente, no a un `middleware.ts` nuevo

El ADR 0001 asumió que no existía ningún gate de acceso a nivel de página en `apps/web`, y eligió
`middleware.ts` (deprecado) por sobre `proxy.ts` porque `withAuth` de NextAuth v4 no estaba verificado
contra la convención nueva. Ambas premisas resultaron falsas:

1. **`apps/web/src/proxy.ts` ya existía**, con un chequeo propio (naive: solo verifica que la cookie de
   sesión de NextAuth *exista*, sin validar firma ni expiración). Se nos pasó por completo durante el
   diseño — solo se buscó `middleware.ts`. Esto además explica el bug original reportado: una cookie de
   sesión vieja/inválida (de cambiar entre `dev` y `dev:remote` con distinto `NEXTAUTH_SECRET` en la misma
   sesión de trabajo) alcanzaba para pasar el chequeo de `proxy.ts`, aunque no fuera una sesión realmente
   válida.
2. **Next.js 16.1.6 no permite que coexistan `middleware.ts` y `proxy.ts`** — falla el build con: *"Both
   middleware file and proxy file are detected. Please use proxy.ts only."* Y, al forzar una elección,
   Next.js **prioriza `proxy.ts`**, no `middleware.ts` — lo opuesto a lo que asumía el ADR 0001.

Con el conflicto de build confirmado (no es teórico, se reprodujo con `next build` real), la única opción
viable es migrar la lógica ya testeada (`isAuthorizedToken`/`isPublicPagePath` de `pageAuthGuard.ts`,
envueltas con `withAuth` de NextAuth v4) directamente a `proxy.ts`, reemplazando su chequeo naive de
cookie por una verificación real de JWT. El archivo `middleware.ts` nuevo se elimina.

La preocupación original del ADR 0001 (¿`withAuth` funciona fuera de Edge?) deja de aplicar: `proxy.ts`
corre siempre en runtime Node.js, que es un superset de las capacidades de Edge, no un subconjunto más
restrictivo — si `withAuth` funciona en Edge (que es su caso de uso documentado), funciona igual en
Node.js.

## Estado

Aceptado.

## Consecuencias

- `apps/web/src/proxy.ts` pasa a usar `withAuth` + `isAuthorizedToken`/`isPublicPagePath` en vez de su
  chequeo manual de cookie.
- El `matcher` de `proxy.ts` se ajusta para excluir `/api` completo (además de estáticos), en vez de la
  lista manual de prefijos públicos (`/api/auth`, `/api/bot`, `/api/meetings`, `/api/v1`) que tenía antes
  — mismo resultado (esas rutas nunca pasan por el gate), implementado por exclusión de matcher en vez de
  chequeo condicional dentro de la función, consistente con el patrón oficial de NextAuth.
- No se crea ningún `middleware.ts` — queda descartado, ver ADR 0001 (superseded).
- Cualquier diseño futuro de request-time gating en `apps/web` debe buscar **ambos** nombres de archivo
  (`middleware.ts` y `proxy.ts`) antes de asumir que no existe ninguno — lección aprendida de este error.
