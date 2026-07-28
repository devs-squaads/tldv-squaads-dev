# 011 · Alineación del Soporte de Chat

**Estado:** spec
**Rama:** ramas de feature desde `dev` (PR-A y luego PR-B, secuenciales)

## Propósito

Realinear la UI, la copy y el conocimiento del Squaads Assistant con el producto ya desplegado. El topic
Soporte afirma falsamente que el soporte está "Próximamente" cuando el flujo de reporte de bug → Discord ya
se renderiza en el mismo panel; el `ReportBugButton` está suelto al final del panel y 100% en inglés dentro
de una UI totalmente en español (voseo); el corpus/`STARTER_TOPICS` todavía describe el comportamiento
previo a 009/010 (enlaces de compartido públicos, falta `transcription_error`); y `searchMeetingsTool`
hardcodea un enum de estados que omite `transcription_error`.

El vocabulario de dominio está fijado por `docs/CONTEXT.md` — este spec usa esos términos exactos:
**Reportar un problema**, **Soporte**, **Acceso** / **dar acceso**, **Enlace de acceso restringido**. Dos
PRs secuenciales, cada uno dentro del presupuesto de 400 líneas.

---

## PR-A — Ubicación del botón de reporte + copy en español

### Requerimiento: ReportBugButton se renderiza solo después de llegar a Soporte (derivado del contenido, sin pipeline de topic-id)

El sistema DEBE renderizar `ReportBugButton` dentro del panel de chat SOLO una vez que la respuesta de
Soporte esté presente en la conversación. La visibilidad DEBE derivarse del contenido de los mensajes
(`hasSupportTopicMarker`, que matchea el substring literal "Reportar un problema" en un mensaje del
asistente) en lugar de un estado efímero de componente — una flag local por sí sola no sobrevive la
restauración de historial desde localStorage/DB de `useChatStream` al recargar, lo cual se encontró y
corrigió durante la implementación mediante la revisión acotada obligatoria post-apply. Sin pipeline de
topic-id, sin detección de intención. `reset()` DEBE limpiar el estado de la conversación para que la
visibilidad derivada vuelva a estar oculta. El botón NO DEBE aparecer en el estado inicial ni durante una
conversación de texto libre no relacionada que nunca llegó a Soporte. *(Excepción visual: la
ubicación/renderizado del botón se valida manualmente según la excepción de TDD visual-UI del repo; el
predicado de derivación en sí tiene tests unitarios.)*

#### Escenario: El click en Soporte revela el botón y la respuesta corregida

- DADO que el asistente está en el estado inicial
- CUANDO el usuario hace click en la tarjeta del topic Soporte
- ENTONCES se renderiza la respuesta corregida de Soporte (sin la afirmación "Próximamente")
- Y el botón "Reportar un problema" se vuelve visible en el panel

#### Escenario: Una conversación de texto libre no revela el botón

- DADO que el usuario inició una conversación de texto libre sin hacer click en Soporte
- CUANDO existen mensajes en el hilo
- ENTONCES el botón "Reportar un problema" NO DEBE estar visible

#### Escenario: La visibilidad del botón sobrevive a una recarga de página

- DADO que el usuario hizo click en Soporte y el botón está visible
- CUANDO la página se recarga y `useChatStream` restaura la conversación desde caché/DB
- ENTONCES la respuesta de Soporte se restaura
- Y el botón "Reportar un problema" está visible de nuevo (no se pierde, porque la visibilidad se deriva
  del contenido de los mensajes restaurados, no de estado efímero)

#### Escenario: El reset vuelve al estado inicial con el botón oculto

- DADO que se hizo click en Soporte y el botón está visible
- CUANDO el usuario resetea la conversación
- ENTONCES los topics iniciales se renderizan de nuevo
- Y la visibilidad derivada (y la flag de revelado manual, ver abajo) resuelven a oculto

### Requerimiento: Una vía de escape manual revela el botón sin perder el historial

El sistema DEBE ofrecer un link manual persistente y siempre visible ("¿Necesitás reportar un problema?",
junto a "Nueva conversación") que revele el botón dentro de la sesión sin resetear la conversación ni
requerir disponibilidad del backend, para el caso en que el historial de una conversación restaurada nunca
llegó a Soporte. Esto cierra un gap de R4 Resilience encontrado durante la revisión acotada obligatoria:
antes de este PR el botón era incondicionalmente visible; después de moverlo detrás de la derivación por
contenido, una conversación restaurada sin el marcador no tenía ninguna vía para alcanzar el botón excepto
perder el historial vía reset.

#### Escenario: El revelado manual funciona sin perder el historial ni el backend

- DADO que una conversación restaurada tiene mensajes pero ninguno referencia Soporte
- CUANDO el usuario hace click en "¿Necesitás reportar un problema?"
- ENTONCES el botón "Reportar un problema" se vuelve visible
- Y el historial de conversación existente se preserva
- Y no se requirió ningún request de red para revelarlo

### Requerimiento: Toda la copy de ReportBugButton está en español (voseo)

El sistema DEBE traducir las 9 strings en inglés de `ReportBugButton.tsx` y `reportBugButton.logic.ts` al
español voseo. La etiqueta del botón colapsado DEBE ser la canónica "Reportar un problema" (según
`CONTEXT.md`). Las strings restantes (placeholder, aria-label, etiqueta de enviar/enviando, cancelar,
feedback de éxito/error) también DEBEN estar en voseo. *(TDD-obligatorio: las strings de
`reportBugButton.logic.ts` — `report-bug-button.logic.test.ts` afirma los literales en inglés textualmente
y DEBE actualizarse primero-el-test en el mismo PR.)*

#### Escenario: El test de lógica afirma los literales en español

- DADO que `report-bug-button.logic.test.ts` actualmente afirma literales en inglés
- CUANDO las strings de lógica se traducen a voseo
- ENTONCES el test se actualiza primero para afirmar los literales en español
- Y `bun test apps/__tests__` pasa sin que quede ningún literal en inglés

### Requerimiento: La respuesta prearmada de Soporte y una línea del corpus enseñan el camino del reporte

El sistema DEBE eliminar la falsa afirmación "Próximamente" de la respuesta de Soporte en
`STARTER_TOPICS` (`ChatMessages.tsx`) y agregar exactamente una línea de corpus que le enseñe al asistente
que un usuario reporta un problema a través del topic Soporte (para que el PR-A sea autoconsistente).

#### Escenario: El asistente explica el camino de reporte de Soporte en texto libre

- DADO que un usuario está en una conversación de texto libre
- CUANDO el usuario pregunta cómo reportar un problema
- ENTONCES el asistente explica que el reporte vive en el topic Soporte ("Reportar un problema")
- Y NO afirma que la funcionalidad está próxima/"Próximamente"

---

## PR-B — Actualización del corpus de conocimiento + fix de raíz del enum de estados

### Requerimiento: El corpus/STARTER_TOPICS reflejan solo la realidad de 009/010

El sistema DEBE actualizar el corpus y `STARTER_TOPICS`, acotado SOLO a los deltas de 009/010: usar el
vocabulario "dar acceso"/"acceso" (nunca "Access Grant" en la copy de usuario); afirmar "enlace de acceso
restringido" como el único tipo de compartido y eliminar cualquier afirmación de "link público"; documentar
las sugerencias de participantes, el bloqueo por owner desactivado, `transcription_error` + su recuperación,
y el auto-grant a co-asistentes de ADR-0007. No se toca ningún otro doc del corpus.

#### Escenario: El corpus ya no ofrece enlaces públicos

- DADO que el corpus antes describía un enlace de compartido público
- CUANDO un usuario pregunta cómo compartir una reunión
- ENTONCES el asistente describe únicamente un "enlace de acceso restringido" (email restringido)
- Y NO DEBE mencionar el compartido público/"link público" como opción vigente

#### Escenario: El corpus refleja la recuperación de transcription_error

- DADO que una reunión llegó a `transcription_error`
- CUANDO un usuario pregunta por qué una reunión muestra un error de transcripción
- ENTONCES el asistente explica que la grabación está a salvo y puede reprocesarse desde el storage

### Requerimiento: El enum de estados de search_meetings se abastece de la lista canónica compartida

El sistema DEBE exportar una lista canónica de estados de reunión desde
`packages/shared/src/domain/meetingStatus.ts` y hacer que `searchMeetingsTool`
(`apps/web/src/integrations/chat/tools/definitions.ts`) la consuma en lugar de un array hardcodeado, de
modo que la tool acepte todos los estados reales, incluido `transcription_error`. *(TDD-obligatorio: el
export del enum y su consumo — primero-el-test.)*

#### Escenario: search_meetings acepta transcription_error

- DADO que la tool `search_meetings` recibe un filtro de estado `transcription_error`
- CUANDO el schema de la tool valida el argumento
- ENTONCES `transcription_error` es un valor válido (no rechazado)
- Y el conjunto aceptado coincide exactamente con la lista canónica de estados compartida

#### Escenario: Agregar un estado no puede desalinear la tool

- DADO que se agrega un nuevo estado a la lista canónica compartida
- CUANDO `searchMeetingsTool` arma su schema
- ENTONCES los estados aceptados por la tool incluyen el nuevo valor sin ninguna edición separada

---

## Objetivos no incluidos

- Sin capa de i18n — solo ediciones directas de string-literals (no se introduce ningún framework).
- Sin auditoría completa de los 18 docs del corpus — solo los deltas de 009/010 + las dos falsedades
  confirmadas.
- Sin detección de intención ni pipeline de topic-id para la ubicación del botón — solo visibilidad
  derivada del contenido más una vía de escape de revelado manual.
- Sin normalización de voseo/tuteo a nivel de toda la app (`MeetingDetailsView` se mantiene en tuteo tal
  cual está).
- Sin actualización de `roadmap.md` (se sabe que está desactualizado — follow-up separado).
- Sin cambios al comportamiento de `manage_meeting_share` (la tool ya es correcta; solo la copy estaba
  mal).
- Sin cambios a archivos del contrato de despliegue (`Dockerfile.*`, `docker-compose*.yml`, `railway.json`,
  CI).
