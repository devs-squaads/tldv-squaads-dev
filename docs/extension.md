# PRD de Implementacion: Extension Multiplataforma para Invitar al Bot

## 1. Resumen Ejecutivo

El proyecto ya dispone de una base backend madura para encolar reuniones, procesarlas con un worker y seguir su ciclo de vida. La nueva extension debe aprovechar esa base y nacer desde cero con una arquitectura mas simple, mas mantenible y con menor dificultad de integracion que el intento anterior.

La propuesta es construir una extension Chrome MV3 enfocada en tres proveedores:

- Google Meet
- Microsoft Teams
- Zoom Web

La estrategia recomendada no es crear tres flujos independientes, sino una unica extension con:

- un contrato comun de deteccion de reunion,
- un contrato comun de estados,
- un servicio comun para hablar con el backend,
- y pequenos adaptadores por proveedor.

Esto reduce complejidad, evita duplicacion y permite que el soporte a nuevos proveedores se amplie sin reescribir la base.

### Vision de producto

Que cualquier usuario interno pueda abrir Meet, Teams o Zoom Web y lanzar el bot con un clic desde la propia reunion, sin pasar por la UI manual del sistema.

### Enfoque profesional y de baja dificultad

Para mantener la integracion ligera, el MVP debe apoyarse al maximo en el backend ya existente:

- reutilizar `meetingStatus.ts` como fuente unica de estados,
- reutilizar la logica de deduplicacion y encolado,
- reutilizar la deteccion de proveedor ya presente,
- y limitar Zoom al caso de uso de Zoom Web, dejando fuera por ahora la app nativa, OAuth complejo y automatizaciones avanzadas.

---

## 2. Auditoria del Estado Actual del Repo

### Estado del repositorio

- El repo esta limpio en este momento.
- No hay implementacion activa de extension en el arbol actual.
- El PRD anterior ya no existe y conviene rehacerlo desde cero.

### Activos reutilizables detectados

#### Estados de dominio ya definidos
Archivo: `src/lib/domain/meetingStatus.ts`

Este archivo ya resuelve una parte muy importante del contrato de producto:

- estados del meeting,
- transiciones validas,
- lista de estados activos.

Debe reutilizarse tal cual para:

- backend,
- extension,
- UI web,
- y futuras notificaciones.

#### Deteccion de proveedor ya existente
Archivo: `src/lib/meetingProvider.ts`

Ya existe una capa simple para resolver el proveedor a partir de la URL. Actualmente soporta:

- Google Meet
- Microsoft Teams

La forma correcta de extender a Zoom es ampliar esta misma pieza, no crear otra paralela.

#### Fabrica de providers del bot
Archivo: `src/lib/bot/src/providers/MeetingProviderFactory.ts`

La arquitectura del bot ya esta pensada por proveedor. Hoy resuelve:

- `GoogleMeet`
- `MicrosoftTeams`

Esto es una base muy buena para una futura clase `ZoomMeeting`.

#### Orquestacion de meetings y deduplicacion
Archivo: `src/lib/services/meetingOrchestrator.ts`

La extension no deberia inventar nueva logica de negocio. Ya existe:

- deduplicacion por ventana temporal,
- encolado,
- control de estados,
- manejo de errores terminales,
- reintentos.

La extension debe ser solo un trigger UX sobre este backend.

#### Auto-join y soporte actual de enlaces
Archivo: `src/lib/services/autoJoinService.ts`

Actualmente el sistema ya reconoce enlaces soportados para auto-join en:

- Google Meet
- Microsoft Teams

No hay Zoom todavia, lo cual confirma que Zoom debe entrar como ampliacion controlada, no como reescritura total.

### Conclusion de la auditoria

El repo no necesita una extension compleja para funcionar. Necesita una capa de navegador pequena y ordenada que reutilice el dominio ya construido. La deuda actual no esta en estados ni en orquestacion, sino en:

- ausencia de extension activa,
- soporte Zoom inexistente,
- falta de un contrato comun frontend-backend para proveedores,
- y falta de un PRD unificado y realista.

---

## 3. Objetivo del Proyecto

Permitir que un usuario invite al bot desde la propia reunion en Google Meet, Microsoft Teams o Zoom Web con una experiencia simple, consistente y basada en componentes reutilizables.

### Objetivos secundarios

- evitar duplicados reutilizando la deduplicacion existente,
- mostrar el estado del bot usando el mismo contrato de estados del backend,
- minimizar codigo especifico por proveedor,
- permitir crecimiento incremental a nuevos proveedores,
- mantener el MVP facil de integrar para empresa.

---

## 4. Principios de Diseno

1. Backend primero, extension ligera.
2. Una sola fuente de verdad para estados.
3. Una sola forma de detectar proveedor.
4. Adaptadores pequenos por plataforma.
5. Nada de OAuth ni integraciones pesadas en el MVP.
6. Zoom solo via navegador web en la primera fase.

---

## 5. Alcance Funcional

### En alcance

- Extension Chrome MV3.
- Soporte de deteccion en Google Meet, Microsoft Teams y Zoom Web.
- Boton flotante o CTA contextual dentro de la reunion.
- Popup de fallback de la extension.
- Estado de grabacion sincronizado con backend.
- Reutilizacion de estados y deduplicacion existentes.
- Diseno preparado para soportar Zoom sin romper Meet/Teams.

### Fuera de alcance en esta nueva implementacion

- Aplicacion nativa de Zoom.
- Publicacion en Chrome Web Store en la primera fase.
- Multiusuario complejo dentro de la extension.
- Automatizacion total sin confirmacion del usuario.
- Reescribir el orquestador o los estados del backend.

---

## 6. Propuesta Tecnica Recomendada

### Arquitectura general

La extension debe tener solo cuatro bloques:

1. `content script`
2. `background/service worker`
3. `popup`
4. `shared contracts`

### Patron recomendado: Adapter por proveedor

Crear un contrato comun:

```ts
interface MeetingPageAdapter {
  canHandle(url: string): boolean;
  getMeetingUrl(): string | null;
  isInsideActiveMeeting(): boolean;
  getProvider(): "google-meet" | "microsoft-teams" | "zoom";
  getMountPoint?(): HTMLElement | null;
}
```

Implementaciones:

- `GoogleMeetAdapter`
- `MicrosoftTeamsAdapter`
- `ZoomWebAdapter`

Con esto:

- el widget es unico,
- la logica de polling es unica,
- la logica de backend es unica,
- y solo cambia la deteccion de contexto por plataforma.

### Servicio comun para backend

La extension no debe repartir llamadas API por todos lados. Debe existir un unico cliente:

```ts
ExtensionApiClient
```

Responsable de:

- `startBot(meetingUrl, provider)`
- `checkStatus(meetingUrl)`
- `getMeeting(meetingId)`
- `getConfig()`

### Reutilizacion obligatoria del dominio existente

#### Reutilizar `meetingStatus.ts`

No redefinir estados en la extension. La extension debe importar o replicar desde una fuente generada a partir de:

- `MeetingStatus`
- `ACTIVE_PROCESSING_STATUSES`
- `canTransitionStatus` si hiciera falta validacion local

La razon es clara:

- evita divergencias,
- evita labels rotos,
- y mantiene consistencia entre UI, backend y worker.

#### Reutilizar `meetingProvider.ts`

Extender la pieza existente para que pase a ser:

- `google-meet`
- `microsoft-teams`
- `zoom`
- `unknown`

Toda deteccion de proveedor, tanto en web como en extension y backend, debe salir de ahi.

#### Reutilizar `meetingOrchestrator.ts`

La extension nunca debe crear reuniones directamente en BD ni saltarse el orquestador. Todo debe seguir pasando por:

- deduplicacion,
- encolado,
- transiciones de estado,
- y control de errores.

---

## 7. Soporte por Plataforma

### Google Meet

Nivel de dificultad: bajo

Motivo:

- ya existe soporte claro en backend,
- ya hay deteccion de proveedor,
- ya hay provider de bot.

### Microsoft Teams

Nivel de dificultad: bajo-medio

Motivo:

- ya existe provider del bot,
- ya existe deteccion de enlaces,
- solo requiere adaptador de extension y pruebas UX.

### Zoom Web

Nivel de dificultad: medio

Motivo:

- no existe provider del bot todavia,
- no existe deteccion formal en `meetingProvider.ts`,
- pero la arquitectura actual admite incorporarlo sin romper lo existente.

### Decision de baja complejidad para Zoom

Para no disparar el coste:

- soportar solo `zoom.us/wc` o flujo equivalente de Zoom Web,
- no soportar app nativa,
- no soportar login federado complejo en primera fase,
- marcar Zoom como soporte incremental dentro del mismo PRD.

---

## 8. Endpoints y Contratos

### Reutilizar

- `POST /api/bot/start`
- `GET /api/meetings/[id]`

### Recomendar mantener o crear

- `GET /api/meetings/status?url=...`

### Contrato de `POST /api/bot/start`

Se recomienda ampliarlo para aceptar `provider` explicito cuando la extension lo conozca:

```json
{
  "meetingUrl": "https://...",
  "provider": "google-meet",
  "botName": "Squaads Assistant",
  "duration": 60
}
```

Esto mantiene compatibilidad y evita depender solo de heuristicas de URL.

---

## 9. Plan de Implementacion

### Fase 0. Contratos y reutilizacion

Objetivo:
consolidar primero el dominio comun antes de escribir extension.

#### Tareas

- ampliar `meetingProvider.ts` para incluir Zoom,
- definir contrato comun de `MeetingProvider`,
- confirmar que `meetingStatus.ts` sera la fuente unica,
- decidir si la extension importa tipos compartidos o usa una generacion automatica.

#### Resultado esperado

Base comun limpia para frontend, backend y worker.

---

### Fase 1. Backend minimo para extension

Objetivo:
dejar listo el backend para que la extension solo dispare acciones.

#### Tareas

- validar que `POST /api/bot/start` acepta proveedor opcional,
- mantener `GET /api/meetings/status`,
- revisar auth de extension con secret o token delegado simple,
- verificar deduplicacion por URL normalizada.

#### Resultado esperado

Backend preparado para extension sin cambios invasivos.

---

### Fase 2. Nueva extension desde cero

Objetivo:
crear una extension limpia y simple, sin arrastrar deuda del intento anterior.

#### Tareas

- crear estructura base MV3,
- crear `ExtensionApiClient`,
- crear widget unico,
- crear popup minimo,
- crear `GoogleMeetAdapter`,
- crear `MicrosoftTeamsAdapter`,
- crear `ZoomWebAdapter`.

#### Resultado esperado

Una sola extension con una sola UI y varios adaptadores.

---

### Fase 3. MVP funcional multiplataforma

Objetivo:
cerrar un MVP usable con el menor riesgo posible.

#### Tareas

- CTA flotante en Meet, Teams y Zoom Web,
- boton de invitar bot,
- polling de estados,
- badge de extension,
- fallback en popup.

#### Resultado esperado

Un flujo manual pero profesional y coherente en los tres proveedores.

---

### Fase 4. Robustez y experiencia

Objetivo:
hacer que la extension sea estable y amigable.

#### Tareas

- normalizacion unica de URL por proveedor,
- errores claros de backend, auth y timeout,
- tests de adaptadores,
- tests de estado compartido,
- trazas de logs con prefijo comun.

#### Resultado esperado

Una extension mantenible y segura para uso interno.

---

### Fase 5. Zoom bot provider

Objetivo:
completar el alcance real para Zoom.

#### Tareas

- crear `ZoomMeeting` en la capa del bot,
- extender `MeetingProviderFactory`,
- extender `meetingProvider.ts`,
- extender deteccion de auto-join si aplica.

#### Resultado esperado

Zoom integrado dentro del mismo patron de providers.

---

## 10. Reutilizacion de Codigo de Alta Calidad

Estas piezas deben considerarse obligatorias para reutilizar:

- `src/lib/domain/meetingStatus.ts`
- `src/lib/meetingProvider.ts`
- `src/lib/services/meetingOrchestrator.ts`
- `src/lib/bot/src/providers/MeetingProviderFactory.ts`
- `src/lib/services/autoJoinService.ts`

### Regla de calidad

Si una nueva pieza de extension redefine estados, proveedores o reglas de deduplicacion ya existentes, se considera mala implementacion.

La extension debe ser una capa de UX, no una segunda logica de negocio.

---

## 11. Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigacion |
| :--- | :--- | :--- |
| Cambios de DOM en cada proveedor | Medio | Adaptadores pequenos y aislados por plataforma |
| Divergencia entre extension y backend | Alto | Reutilizar `meetingStatus.ts` y `meetingProvider.ts` |
| Zoom aumenta complejidad | Medio | Limitar primera fase a Zoom Web |
| Duplicados por URL distinta | Alto | Normalizacion comun por proveedor |
| Extension demasiado tecnica | Medio | Popup minimo y backend reutilizable |

---

## 12. Recomendacion Final

La mejor decision no es recuperar la extension anterior. La mejor decision es:

1. empezar una implementacion nueva,
2. mantener el backend actual como fuente de verdad,
3. reutilizar estados y deteccion de proveedor ya construidos,
4. lanzar un MVP unico para Meet, Teams y Zoom Web con adaptadores pequenos.

### Recomendacion de prioridad

1. Consolidar contratos comunes.
2. Crear extension limpia desde cero.
3. Sacar MVP con Meet y Teams listos y Zoom preparado en la misma arquitectura.
4. Completar provider de Zoom como siguiente entrega controlada.

Este enfoque es el mas profesional, el mas seguro y el de menor dificultad real para integrar sin sacrificar calidad de codigo.

---

## 13. Sincronizacion de Estados (Single Poller + Port)

### Problema resuelto

El polling HTTP puro con piso de 5s, dos loops independientes (widget y popup) contra los mismos
endpoints, y re-render completo via `innerHTML` en cada respuesta causaban:

- latencia alta en la refleccion de cambios de estado,
- desincronizacion entre widget y popup,
- parpadeo y perdida de interaccion (drag) al re-renderizar.

### Arquitectura

**Single Poller**: el service worker es el unico componente que hace `GET` de Meeting Status al
backend por meeting activo. Widget y popup se suscriben via Port y nunca hacen fetch propio.

**Port-as-keepalive**: el content script (widget) y el popup abren un `chrome.runtime.connect` de
larga vida al SW. Ese Port es simultaneamente:

1. el canal por donde viajan los `MEETING_UPDATE` (SW -> suscriptores),
2. el keepalive que mantiene al SW despierto (Chrome 114+: long-lived messaging keeps SW alive),
3. el contador de suscriptores (SW cuenta Ports abiertos; si ==0, cae a `chrome.alarms` 30s).

**Maquina de estados pura** (`apps/extension/src/shared/status-sync.ts`): toda la logica de decision
(diff, intervalo adaptativo, gestion de loops, handshakes, cleanup) vive en una funcion pura
`{state, event} -> {newState, effects[]}`. Los effects son un ADT que el SW ejecuta. Esto permite
TDD real con Bun en `apps/__tests__/extension/`.

### Eventos y Effects

Eventos (SW -> maquina): `SUBSCRIBE`, `POLL_TICK`, `POLL_RESPONSE`, `POLL_ERROR`, `DISCONNECT`,
`HANDSHAKE_TIMEOUT`.

Effects (maquina -> SW): `startLoop`, `stopLoop`, `fetchSnapshot`, `fetchMeeting`, `broadcast`,
`disconnectPorts`, `disconnectPort`.

### Intervalo adaptativo

- 2s para fases transitorias (`pending`/`joining`/`waiting_admission`).
- 5s para fases estables (`recording`/`transcribing`/`summarizing`).
- Justificacion: reducir requests contra Supabase EU pooler en fases de cambio lento.

### Request lenta

- No solapamiento (guard `inFlight` en la maquina).
- Relanzar inmediatamente tras resolucion (no esperar al proximo tick).
- `POLL_ERROR` limpia `inFlight` para que el ciclo se recupere solo.

### Estado terminal

- Broadcast final garantizado a todos los Ports.
- Luego: `stopLoop` + `disconnectPorts` + cleanup del registro.
- Los suscriptores tratan `onDisconnect` post-terminal como "mantener el ultimo estado mostrado".

### Render quirurgico (widget)

- `mount()` (innerHTML, una vez) crea el DOM.
- `patchStatus(status)` (N veces) actualiza solo color del indicador, texto del mensaje y boton de
  accion sin destruir el nodo arrastrado.
- `diff(prev, next)` decide si el render es `none` (no-op), `status` (patch) o `full` (mount).

### Popup con dos modos

- "Buscando meeting": mini-poll `CHECK_STATUS` a 2s via `sendMessage` (sin Port).
- "Suscripto": cuando un meeting aparece, abre Port, manda `SUBSCRIBE`, elimina el mini-poll.

### Fallback degradado

- `chrome.alarms` a 30s (minimo de Chrome 120+) como wake-up de seguridad cuando no hay ningun Port
  activo. No es el tick base del loop.

