# Auth & Access Control

Cómo se identifica y autoriza a quien llama a `apps/web`: tres esquemas de auth distintos conviven en el
mismo backend, cada uno con su propio propósito y superficie de rutas. No son intercambiables.

## Language

**Session Auth**:
Autenticación por cookie de NextAuth (JWT), para humanos navegando el dashboard en el navegador
(`/`, `/settings`, etc.). Se resuelve con `getServerSession`/`getToken`, gated por `Authorized Account`.
_Avoid_: user auth, cookie auth, login token.

**Extension Access Token**:
Token HMAC propio (no JWT de NextAuth) emitido por `POST /api/v1/extension/connect` a partir de un
`extension_link` de corta duración generado en el dashboard. Lo usa la extensión de Chrome como
`Authorization: Bearer` contra `/api/v1/extension/*`. Requiere `Session Auth` previa para generarse,
pero es un mecanismo separado una vez emitido.
_Avoid_: extension session, extension cookie, link token (ese es solo el paso intermedio de 10 min).

**API Route Secret**:
Secreto compartido (`API_ROUTE_SECRET`) como `Authorization: Bearer` para clientes externos /
máquina-a-máquina (`/api/bot/*`, `/api/meetings/*`, `/api/v1/shares/*`, `/api/v1/meetings/*`). No
depende de ningún usuario ni sesión.
_Avoid_: API key, service token.

**Authorized Account**:
Fila en `authorized_accounts` (email + rol `admin`/`member` + `isActive`) que determina si un email
puede completar `Session Auth`. Gestionada por un admin desde "Equipo" en Ajustes, o autoprovisionada
para emails en `SUPER_ADMIN_EMAILS`.
_Avoid_: allowlist entry, whitelisted user.

**Public Route**:
Superficie servida sin ningún esquema de auth, a propósito: `/share/[token]` (enlaces compartidos
externos) y `/api/v1/public/shares/*`. No confundir con rutas que simplemente no chequean auth por
omisión (bug) — esas son un gap, no una `Public Route` intencional.
_Avoid_: unprotected route (ambiguo — no distingue "público a propósito" de "gap sin querer").
