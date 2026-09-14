# 015 · Cierre de la superficie de autorización (hallazgos de la auditoría 2026-08-03)

**Estado:** spec (proposal confirmed)

## Propósito

Una auditoría de seguridad sobre `dev` encontró **cinco rutas de la API que no aplican el modelo de
autorización del proyecto**, dos de ellas de lectura de datos ajenos (IDOR) y tres de escritura sin
autenticación alguna. No es deuda teórica: son vulnerabilidades explotables hoy contra cualquier
despliegue, y contradicen reglas que el propio repositorio ya declara por escrito
(`WebMeetingRepository.ts:19-20`: «No `authorizedAccounts.role` bypass exists; this filter is identical
for every user»).

El modelo de visibilidad correcto **ya existe** y está implementado en
`WebMeetingRepository.visibleToUser()` (owner + Access Grant vivo + owner activo). Estas rutas
simplemente no lo usan: nacieron en el commit inicial, y el retrofit de ownership de la feature 009 las
dejó atrás (`git log` de las dos rutas: último toque `c79c8da`, PR7 de 009, solo para storage keys).

El objetivo es cerrar las cinco sin regresiones: **ninguna ruta legítima debe dejar de funcionar**, y la
visibilidad debe ser la misma que la del dashboard.

## Requirements

### Requirement: La lectura de una reunión por ID respeta el ownership

`GET /api/meetings/[id]` NO DEBE devolver una reunión a una Session Auth que no sea su Owner ni tenga un
Access Grant vivo sobre ella. DEBE seguir devolviendo 401 sin sesión y sin secreto, 404 si la reunión no
existe, y DEBE conservar intacto el camino máquina-a-máquina autenticado con `API_ROUTE_SECRET`, que es
de confianza por ser server-to-server y no está sujeto a ownership.

#### Scenario: Un member lee una reunión ajena

- DADO una Session Auth válida de un usuario sin ownership ni grant sobre la reunión
- CUANDO llama a `GET /api/meetings/:id` con ese id
- ENTONCES la respuesta es 404 (no se filtra siquiera la existencia de la reunión)
- Y el cuerpo NO contiene `rawTranscription`, `summary` ni `recordingFilePath`

#### Scenario: El Owner lee su propia reunión

- DADO una Session Auth válida del Owner de la reunión
- CUANDO llama a `GET /api/meetings/:id`
- ENTONCES la respuesta es 200 con la reunión
- Y si está `completed` y tiene grabación, `recordingFilePath` es la URL firmada

#### Scenario: Un grantee con acceso vivo lee la reunión

- DADO una Session Auth válida de un usuario con un Access Grant vivo sobre la reunión
- CUANDO llama a `GET /api/meetings/:id`
- ENTONCES la respuesta es 200 con la reunión

#### Scenario: El worker (máquina a máquina) sigue leyendo sin ownership

- DADO una petición con `Authorization: Bearer $API_ROUTE_SECRET` y sin sesión
- CUANDO llama a `GET /api/meetings/:id` de cualquier reunión
- ENTONCES la respuesta es 200 con la reunión

### Requirement: La lectura de una reunión desde la extensión respeta el ownership

`GET /api/v1/extension/meetings/[id]` NO DEBE devolver una reunión cuyo `userId` del token de extensión no
sea Owner ni tenga un Access Grant vivo. Un token de extensión válido de otra persona NO DEBE ser
suficiente. La regla DEBE ser la misma que la del dashboard (owner **o** grant), no la owner-only del
hermano `/status`, para que la extensión no muestre como `idle` una reunión que el dashboard sí lista.

#### Scenario: Un token de extensión ajeno no ve la reunión

- DADO un token de extensión válido cuyo `userId` no es Owner ni tiene grant
- CUANDO llama a `GET /api/v1/extension/meetings/:id`
- ENTONCES la respuesta es 404
- Y no se genera ninguna URL firmada de grabación

#### Scenario: El dueño del token ve su propia reunión

- DADO un token de extensión válido cuyo `userId` es el Owner
- CUANDO llama a `GET /api/v1/extension/meetings/:id`
- ENTONCES la respuesta es 200 con la reunión

### Requirement: La configuración global sólo admite claves editables conocidas

`POST /api/settings` NO DEBE aceptar escrituras sin Session Auth, y NO DEBE escribir claves arbitrarias.
DEBE restringirse a una allowlist explícita de claves editables desde la UI, porque la tabla `settings`
aloja también `transcription_context` y `transcription_dictionary`, que se inyectan en el prompt de ASR
(`groq.ts`) y del refiner (`gemini.ts`): una escritura arbitraria es una inyección de prompt persistente
sobre todas las reuniones de la instalación.

#### Scenario: Petición anónima rechazada

- DADO una petición sin sesión
- CUANDO hace `POST /api/settings` con `{ "transcription_context": "..." }`
- ENTONCES la respuesta es 401
- Y el repositorio de settings no recibe ninguna escritura

#### Scenario: Clave fuera de la allowlist rechazada con sesión válida

- DADO una Session Auth válida
- CUANDO hace `POST /api/settings` con `{ "transcription_dictionary": "..." }`
- ENTONCES la respuesta es 400
- Y el repositorio de settings no recibe ninguna escritura

#### Scenario: La clave editable de la UI sigue funcionando

- DADO una Session Auth válida
- CUANDO hace `POST /api/settings` con `{ "monitor_email": "ops@squaads.com" }`
- ENTONCES la respuesta es 200
- Y el repositorio recibe exactamente esa clave con ese valor

### Requirement: Las credenciales del Service Account de Google exigen Session Auth

`GET`, `POST` y `DELETE` de `/api/settings/google-credentials` NO DEBEN ser accesibles sin Session Auth.
`POST` escribe un fichero en disco y `DELETE` lo borra: sin autenticación, cualquiera en internet puede
sustituir la credencial que el worker usa para leer Google Calendar.

#### Scenario: Petición anónima rechazada en los tres verbos

- DADO una petición sin sesión
- CUANDO llama a `GET`, `POST` o `DELETE` de `/api/settings/google-credentials`
- ENTONCES la respuesta es 401
- Y no se escribe ni se borra ningún fichero

#### Scenario: El administrador sigue gestionando la credencial

- DADO una Session Auth válida
- CUANDO llama a `GET`, `POST` o `DELETE` de `/api/settings/google-credentials`
- ENTONCES la respuesta es 200 y el comportamiento es el actual

### Requirement: El disparador del auto-join del worker exige autenticación máquina a máquina

`GET /api/bot/poll` NO DEBE ser anónimo: dispara un ciclo de auto-join que puede encolar reuniones y unir
el bot a ellas. DEBE exigir el `API_ROUTE_SECRET` compartido, igual que el resto de rutas internas.

#### Scenario: Petición anónima rechazada

- DADO una petición sin cabecera `Authorization`
- CUANDO llama a `GET /api/bot/poll`
- ENTONCES la respuesta es 401
- Y no se llama al worker

#### Scenario: Un cron externo con el secreto sigue funcionando

- DADO una petición con `Authorization: Bearer $API_ROUTE_SECRET`
- CUANDO llama a `GET /api/bot/poll`
- ENTONCES la respuesta es 200 con el resultado del poll

## Fuera de alcance (declarado, no olvidado)

- **`assertPrivateApiAuthorized` es fail-open** cuando `API_ROUTE_SECRET` no está definido
  (`privateApiAuth.ts:5`: `if (!secret) return null;`). Cambiarlo a fail-closed es lo correcto, pero puede
  tumbar el canal web↔worker de un despliegue al que le falte la variable: se decide con la persona, no
  en este cambio.
- **Un `member` autenticado sigue pudiendo rotar la credencial de Google y editar el contexto IA global**
  (`/api/settings/transcription` sólo exige sesión). Es una decisión de permisos de producto, no la
  vulnerabilidad anónima que cierra esta feature.
- **`GET /api/settings` no existe**; `SettingsView` sólo hace `POST`. No se añade.
- El resto de hallazgos de la auditoría (lease/watchdog, `admission_timeout`, fuga del diccionario,
  sincronía A/V) van en sus propias features.
