# Usar `middleware.ts` (deprecado, no `proxy.ts`) para el gate de auth a nivel de página

Next.js 16 (la versión de este proyecto) deprecó `middleware.ts` en favor de `proxy.ts`, que corre
siempre en runtime Node.js en vez de Edge. Decidimos quedarnos con `middleware.ts` igual, envuelto con
`withAuth` de NextAuth v4 (`next-auth/middleware`), porque `withAuth` solo está documentado y verificado
sobre la convención `middleware.ts` — NextAuth v4 es anterior a `proxy.ts` y no hay ninguna confirmación
de que se comporte igual ahí. Arriesgar una combinación sin verificar en un gate crítico de seguridad se
consideró peor que quedarnos con un nombre de archivo deprecado pero soportado.

## Estado

Superseded por [0002-migrate-auth-gate-into-existing-proxy-ts.md](0002-migrate-auth-gate-into-existing-proxy-ts.md).
La premisa de este ADR (que no existía ningún gate previo, y que `proxy.ts` era terreno sin probar) era
incorrecta — ver el ADR 0002 para el motivo real y la corrección.

## Opciones consideradas

- **`proxy.ts`** — la convención hacia adelante de Next.js 16, pero sin probar con `withAuth` de
  NextAuth v4. Descartada para este cambio; revisar cuando el proyecto migre de NextAuth v4 (v5/Auth.js
  tiene soporte de primera clase para `proxy.ts`) o se confirme explícitamente la compatibilidad.
- **Cubrir `/api/*` en el mismo matcher del middleware** — descartada. Todos los ejemplos oficiales de
  NextAuth (v4 y v5) excluyen `/api` del matcher, y las rutas de API de este proyecto ya se protegen
  solas vía `getServerSession` por ruta. Sumar cobertura de middleware ahí solo agregaría complejidad de
  redirect-vs-401 sin arreglar ningún bug real.

## Consecuencias

- El middleware solo toca rutas de página (el matcher excluye `/api`, `_next/static`, `_next/image`,
  `favicon.ico`), más exclusiones explícitas para `/login` y `/share/[token]` (ambas públicas a propósito).
- Si NextAuth se actualiza a v5/Auth.js en el futuro, esta decisión debe revisarse — `proxy.ts` pasa a
  ser la opción correcta y documentada en ese momento, y este ADR debería marcarse como superseded.
