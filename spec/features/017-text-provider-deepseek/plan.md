# Plan · 017 Proveedor de texto DeepSeek

## Estrategia

Introducir el contrato que falta. Hoy el texto se genera con funciones ad-hoc que ramifican por
proveedor dentro de la lógica de negocio (`generateWithGroq` / `generateWithGemini` en `gemini.ts`,
`attributeWithGroq` / `attributeWithGemini` en `speakerAttribution.ts`), lo que la constitución prohíbe
explícitamente. Se crea un contrato `TextGenerationProvider` con implementaciones y factory, se añade
DeepSeek y se reescriben los dos servicios para consumirlo.

Es un refactor de proveedor, no un cambio de comportamiento visible: los prompts y las guardas de
fidelidad de la 016 se conservan tal cual.

## Decisiones de diseño

### 1. El contrato vive en `integrations/ai/text/`, junto a los otros

Sigue el patrón ya existente de `integrations/ai/transcription/` y `integrations/ai/summary/`:
contrato + `providers/` + factory. El nombre del proveedor se resuelve con `TEXT_PROVIDER` y, si no está,
por autodetección (DeepSeek si hay clave, luego Gemini). Coherente con `TranscriptionProviderFactory`.

### 2. DeepSeek se implementa con el SDK `openai` que ya está en el worker

El API de DeepSeek es compatible con OpenAI (`base_url=https://api.deepseek.com`), y `openai@^6` ya es
dependencia del worker. Añadir un SDK nuevo sería dependencia innecesaria y riesgo de drift de `bun.lock`
(que un test del repo vigila).

### 3. Dos modos de petición, porque el modelo razona

Medido: `deepseek-flash` gastó 7004 tokens de razonamiento para reemitir 6000 caracteres, y con 8000 de
presupuesto la respuesta se truncó al 55 %. El contrato expone `reasoning: "off" | "auto"`:

- **`off`** en las tareas mecánicas de copia (atribución de hablantes y refiner). Medido: 7,7 s y 0
  tokens de razonamiento frente a 23,1 s y 4645.
- **`auto`** donde el modelo tiene que pensar (resumen, capítulos, acciones).

Esto no es una optimización cosmética: sin `off`, la tarea de copia se trunca.

### 4. NUNCA `max_tokens`, y el razonamiento se apaga en las tareas de copia

**Regla del proyecto, por indicación expresa:** ninguna llamada a un LLM fija `max_tokens`. Un tope
artificial trunca la respuesta, y aquí truncar es perder contenido de la reunión.

Medido en esta misma sesión: con `max_tokens: 8000` la atribución de un fragmento de 6069 caracteres se
cortó al **55 %** (`finish=length`) y se comió 7004 tokens razonando. Sin el tope, la misma petición
devolvió las 80 líneas completas.

Esto **deroga** la función `resolveTextOutputBudget` que introdujo la 016: se elimina, junto con sus
tests, y en su lugar queda la regla documentada. La guarda de truncado (`finish_reason === "length"` y
ratio de caracteres) se mantiene como red de seguridad por si un proveedor impone su propio límite.

Aparte, `deepseek-flash` es un modelo de razonamiento y el razonamiento consume tiempo y presupuesto
interno. Medido sobre la misma tarea: 23,1 s con razonamiento por defecto frente a **7,7 s y cero tokens
de razonamiento** desactivándolo. Para copiar texto no aporta nada, así que el contrato expone
`reasoning: "off" | "auto"`: `off` en atribución y refiner, `auto` en resumen.

### 5. Gemini queda como respaldo, no como primario

Su clave está con el tope de gasto agotado, así que no se puede verificar. Se mantiene implementado y
configurable, pero el primario verificado es DeepSeek.

## Ficheros afectados

| Fichero | Cambio |
|---|---|
| `apps/worker/src/integrations/ai/text/TextGenerationProvider.ts` | **nuevo** — contrato |
| `apps/worker/src/integrations/ai/text/providers/DeepSeekTextProvider.ts` | **nuevo** |
| `apps/worker/src/integrations/ai/text/providers/GeminiTextProvider.ts` | **nuevo** |
| `apps/worker/src/integrations/ai/text/TextGenerationProviderFactory.ts` | **nuevo** |
| `apps/worker/src/services/aiModels.ts` | modelo de texto pasa a DeepSeek; se retira el de Groq |
| `apps/worker/src/services/gemini.ts` | resumen y refiner por el contrato; se retiran las ramas por proveedor |
| `apps/worker/src/services/speakerAttribution.ts` | atribución por el contrato; se retiran las ramas |
| `apps/worker/src/scripts/doctorAi.ts` | reporta el proveedor de texto real |
| `apps/__tests__/worker/**` | tests de contrato, factory y presupuesto |
| `README.md`, `.env.*.example` | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `TEXT_PROVIDER` |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Refactor de proveedor rompe el pipeline que acaba de arreglarse | Los prompts y las guardas no cambian; `doctor:ai` y el E2E real sobre la grabación de 53,5 min se repiten antes de dar nada por bueno |
| El razonamiento se come el presupuesto otra vez | Modo `off` en tareas de copia + guarda de truncado + test del presupuesto |
| Coste por token al subir el presupuesto | El presupuesto es un techo, no un gasto: sólo se factura lo emitido. Y `thinking: off` reduce el consumo real |
| Cambio de proveedor altera la calidad de la diarización | Se mide con la misma grabación y el mismo criterio que en la 016 (segmentos conservados, cobertura, turnos) |

## Verificación

1. Tests de contrato y factory en rojo → verde.
2. `bun test apps/__tests__ --isolate` sin regresiones.
3. `typecheck`, `lint`, `build:web`.
4. `bun run doctor:ai` con las cuatro etapas OK y reportando DeepSeek.
5. E2E real sobre la grabación de 53,5 min, comparado contra la medición de la 016 (826 segmentos, 826/826 con hablante, cobertura hasta [53:23]).
6. Revisión de frontera (Astra).
