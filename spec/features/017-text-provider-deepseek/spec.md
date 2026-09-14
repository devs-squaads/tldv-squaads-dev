# 017 · Proveedor de texto DeepSeek y retirada de Groq del camino de texto

**Estado:** spec (proposal confirmed)

## Propósito

Decisión de la persona (2026-09-14): **nada de Groq** para el texto. Groq se usaba en cinco sitios y
tres de ellos (resumen, refiner y diarización) apuntaban a `llama-3.3-70b-versatile`, un modelo que ya
no existe en la cuenta: es la causa directa de que la 016 encontrara tres etapas caídas.

La feature 016 dejó el pipeline funcionando con `openai/gpt-oss-120b` de Groq, que era lo único
verificado entonces. Esta feature mueve el texto a **DeepSeek** (`deepseek-flash`), verificado con
llamadas reales, y deja el camino de texto sin dependencia de Groq.

Groq **sigue siendo el proveedor de ASR** (Whisper) en esta feature: no hay alternativa verificada
todavía porque la clave de Gemini está con el tope de gasto mensual agotado. Eso se decide aparte, y se
declara aquí para que no parezca un olvido.

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

- **Mover el ASR fuera de Groq.** Whisper sigue siendo el transcriptor porque la alternativa acordada
  (`gemini-3.8-flash` con entrada de audio) está bloqueada por el tope de gasto mensual del proyecto de
  Gemini. En cuanto se levante, cambiar es una variable de entorno más la implementación del proveedor.
- **Quitar el SDK de Groq del worker**, porque el ASR lo sigue usando.
- **Nombres reales de hablante**: sigue en su propia feature.
