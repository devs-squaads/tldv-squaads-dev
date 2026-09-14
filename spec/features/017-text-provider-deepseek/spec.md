# 017 · Sin Groq: Gemini para audio y DeepSeek para texto

**Estado:** spec (proposal confirmed)

## Propósito

Decisión de la persona (2026-09-14): **no se usa Groq**. Groq estaba en cinco sitios y tres de ellos
(resumen, refiner y diarización) apuntaban a `llama-3.3-70b-versatile`, un modelo que ya no existe en la
cuenta: es la causa directa de que la 016 encontrara tres etapas caídas.

El reparto nuevo, verificado con llamadas reales antes de escribir código:

| Camino | Proveedor | Por qué |
|---|---|---|
| **Audio** (transcribir + diarizar) | **Gemini 3.8 Flash** | Acepta audio y **diariza de forma acústica**: distingue las voces del propio audio, no las infiere del texto. Medido en la reunión real de 53,5 min por el pipeline completo: 119,3 s, 365/365 segmentos con hablante, nombres reales y cobertura hasta [52:57] |
| **Texto** (refiner + resumen) | **DeepSeek `deepseek-flash`** | API compatible con OpenAI, verificada. Con razonamiento desactivado, 7,7 s frente a 23,1 s en las tareas de copia |
| Respaldo de texto | Gemini 3.8 Flash | Se activa solo si el primario falla o se agota su tiempo |

Groq desaparece del worker y del chat de la web. Además, el ASR deja de necesitar el paso aparte de
atribución de hablantes por LLM: Gemini devuelve los hablantes en la misma respuesta, así que se ahorra
una llamada y desaparece el problema de identidades que se reinician entre fragmentos.

## Medido antes de escribir código (2026-09-14)

| Prueba | Resultado |
|---|---|
| `GET /models` con la clave | `deepseek-flash`, `deepseek-v4-pro` |
| Chat simple | Responde; el API es compatible con OpenAI (`base_url=https://api.deepseek.com`) |
| Atribución con `max_tokens: 8000` | **Truncada al 55 %** (`finish=length`) y 7004 tokens de razonamiento |
| Atribución con `max_tokens: 32000` | 80/80 líneas, ratio 120 %, `finish=stop`, 23,1 s, 4645 de razonamiento |
| Igual con `reasoning_effort: "low"` | 80/80 líneas, 18,7 s, 3125 de razonamiento |
| Igual con `thinking: {type: "disabled"}` | 80/80 líneas, **7,7 s, 0 de razonamiento** |

Conclusión que gobierna el diseño: **es un modelo de razonamiento**, el razonamiento consume el mismo
presupuesto que la salida, y para una tarea mecánica de copiar texto conviene desactivarlo. Sin eso, el
presupuesto aparentemente holgado se agota razonando y la respuesta se trunca.

## Requirements

### Requirement: El camino de texto no depende de Groq

El resumen, el refiner y la atribución de hablantes NO DEBEN llamar a la API de Groq. DEBEN resolverse a
través de un contrato de generación de texto con sus implementaciones y su factory, sin ramas por
proveedor en la lógica de negocio.

#### Scenario: Un entorno sólo con DeepSeek

- DADO un entorno con `DEEPSEEK_API_KEY` y sin `GROQ_API_KEY`
- CUANDO se resuelve el proveedor de texto
- ENTONCES el proveedor es DeepSeek
- Y el resumen, el refiner y la atribución funcionan

#### Scenario: Ningún proveedor de texto configurado

- DADO un entorno sin `DEEPSEEK_API_KEY` ni `GEMINI_API_KEY`
- CUANDO se resuelve el proveedor de texto
- ENTONCES el sistema lo reporta como no configurado en vez de fallar a mitad de una reunión

### Requirement: La factory respeta la selección explícita y cae al respaldo

#### Scenario: Selección explícita

- DADO `TEXT_PROVIDER=gemini`
- CUANDO se resuelve el proveedor
- ENTONCES se usa Gemini aunque haya clave de DeepSeek

#### Scenario: Respaldo ante fallo del primario

- DADO un proveedor primario que falla
- CUANDO se genera texto
- ENTONCES se intenta el proveedor de respaldo si está configurado
- Y si tampoco hay respaldo, el error se propaga para que el llamante degrade

### Requirement: NUNCA se fija `max_tokens` en una llamada a un LLM

Ninguna llamada a un modelo de lenguaje DEBE llevar `max_tokens` (ni `max_completion_tokens` ni
`maxOutputTokens`). Un tope artificial trunca la respuesta, y en este pipeline truncar significa perder
contenido de la reunión o descartar el trabajo del refiner.

#### Scenario: Llamada sin tope artificial

- DADO cualquier punto del código que llame a un LLM
- CUANDO se construye la petición
- ENTONCES no incluye ningún parámetro de máximo de tokens

#### Scenario: El proveedor impone su propio límite

- DADO un proveedor que agota su límite de salida
- CUANDO se recibe la respuesta
- ENTONCES el resultado se marca como truncado (`finish_reason === "length"`)
- Y la guarda de fidelidad descarta el resultado conservando el contenido original

### Requirement: El modo de razonamiento se ajusta a la tarea

Las tareas mecánicas de copia (atribución de hablantes y refiner) DEBEN poder desactivar el razonamiento;
las que requieren juicio (resumen, capítulos, acciones) DEBEN dejarlo activo.

#### Scenario: Tarea de copia con DeepSeek

- DADO un transcript de ~6000 caracteres
- CUANDO se pide la atribución de hablantes
- ENTONCES la petición desactiva el razonamiento
- Y el resultado no se trunca

### Requirement: Los identificadores de modelo son configurables y no hay valores retirados

#### Scenario: Defaults verificados

- DADO un entorno sin variables de modelo
- CUANDO se resuelve la configuración
- ENTONCES el modelo de texto es `deepseek-flash`
- Y el de Gemini es `gemini-3.8-flash`
- Y el de ASR es `whisper-large-v3`

#### Scenario: Modelo retirado configurado

- DADO `DEEPSEEK_MODEL=llama-3.3-70b-versatile`
- CUANDO se resuelve la configuración
- ENTONCES se descarta con aviso y se usa el valor por defecto

### Requirement: La comprobación de salud cubre el proveedor nuevo

#### Scenario: doctor:ai con DeepSeek

- DADO un entorno con `DEEPSEEK_API_KEY`
- CUANDO se ejecuta `bun run doctor:ai`
- ENTONCES la etapa de modelo de texto reporta DeepSeek
- Y las cuatro etapas responden
- Y el código de salida es cero

## Fuera de alcance (declarado)

- **Reconciliación de identidades cuando haya que trocear el audio.** Si el audio supera el límite en
  línea de Gemini (~12 MB, unas 2,3 h de opus), cada fragmento se diariza por separado y las etiquetas
  pueden reiniciarse. La reunión medida (8,96 MB de audio) entra en una sola petición, así que la
  diarización es consistente de principio a fin; el troceo queda como red de seguridad.
- **Nombres reales garantizados.** Gemini los deduce del contexto y en la prueba real acertó (`Eduardo`,
  `Marta`, `Junior`), pero cuando no hay evidencia usa `Hablante N`. No se inventan identidades.
- **Quitar el SDK `openai` del worker**: lo sigue usando el proveedor de resumen de OpenAI.
- **Rediseñar el catálogo de diagnósticos del chat** más allá de sustituir los proveedores.
