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

# Meeting Status

El ciclo de vida de un bot de reunión y quién dice la verdad sobre él. La extensión lo muestra en dos
superficies (widget flotante dentro del Meet, popup) que deben coincidir siempre.

## Language

**Meeting Status**:
El estado canónico del ciclo de vida de un bot de reunión (`pending`, `joining`, `waiting_admission`,
`recording`, `transcribing`, `summarizing`, `completed`, o terminal de fallo). El backend (Supabase vía
web API) es la única fuente de verdad; cualquier valor retenido en el cliente es una caché cálida, no
dato canónico.
_Avoid_: meeting state (genérico), status value.

**Single Poller**:
El único componente autorizado a hacer `GET` de `Meeting Status` al backend por meeting activo. Las demás
superficies (widget, popup) se suscriben a él y nunca hacen fetch propio. Su memoria en MV3 no es
persistente: al despertar, la caché está fría y debe re-fetchear antes de responder a un suscriptor tardío.
_Avoid_: polling loop (describe el mecanismo, no el rol), status source.

_Avoid_ (frase): **"fuente de estado única"** — ambigua: confunde el dueño del dato (el backend) con el
deduplicador de fetch (el Single Poller). Usar "Single Poller" para el rol y "backend" para el dueño.
