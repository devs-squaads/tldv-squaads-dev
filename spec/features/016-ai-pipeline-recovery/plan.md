# Plan · 016 Pipeline de IA funcional de extremo a extremo

## Estrategia

Separar la **decisión** (pura, testeable con TDD) de la **ejecución** (ffmpeg, red). Los tres módulos
puros nuevos se cubren con tests en `apps/__tests__/worker/services/`; la parte de ffmpeg y las llamadas
reales se validan por integración contra la grabación de 53 minutos, que es la excepción que la
constitución permite para captura multimedia.

## Decisiones de diseño

### 1. La preparación de audio va en `transcribeRecording`, no en cada proveedor

`transcribeRecording` (`meetingAiProcessingService.ts:131`) es el único punto por el que pasan **los dos**
caminos que transcriben: el pipeline normal (`meetingWorkerService.ts:134`) y el reprocesado
(`meetingRecoveryService.ts:62`). Poner ahí la preparación arregla ambos de una vez y mantiene el
contrato `TranscriptionProvider` intacto: el proveedor sigue recibiendo una ruta de fichero, sólo que
ahora es audio. Cero acoplamiento nuevo a proveedores.

### 2. Extraer siempre, no sólo cuando haga falta

Se podría extraer audio sólo si el fichero supera el límite, pero eso deja el camino rápido sin probar
nunca. Extraer siempre tiene tres ventajas medidas: el MP4 de 375 MB baja a 8,95 MB (42× menos subida),
el coste por minuto del ASR no cambia, y el camino es el mismo en desarrollo y en producción. El coste es
una pasada de ffmpeg, que ya está en la imagen y ya se usa para grabar.

Se usa **opus mono 16 kHz a 24 kbps**: 53,5 minutos → 8,95 MB. Whisper trabaja internamente a 16 kHz, así
que no se pierde información relevante y se gana margen de sobra contra el límite.

### 3. Trocear sólo como red de seguridad

El límite de Groq es de 25 MB. Con 24 kbps eso son ~2,3 horas de reunión, más que la duración máxima
configurada por defecto (`BOT_DEFAULT_DURATION_MINUTES=60`, y el tope de los casos reales). Aun así, el
troceo con solapamiento se implementa porque una reunión de 4 horas o un bitrate distinto lo alcanzarían,
y porque el fallo actual (413) es precisamente un caso de límite no contemplado. El solapamiento evita
cortar una palabra a la mitad entre dos segmentos.

### 4. Modelos: resolver, no hardcodear

Un único módulo `aiModels.ts` resuelve los tres identificadores desde entorno con valores por defecto
**verificados con llamadas reales**:

| Variable | Por defecto | Verificación |
|---|---|---|
| `GROQ_TRANSCRIPTION_MODEL` | `whisper-large-v3` | Existe en la cuenta; transcribió 53 min en 14,6 s |
| `GROQ_TEXT_MODEL` | `openai/gpt-oss-120b` | Existe; respondió con JSON válido. Es de razonamiento: consume tokens de razonamiento, así que necesita presupuesto de salida holgado |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Existe en la clave (1M entrada / 65k salida), pero **el proyecto tiene el tope de gasto agotado**: es el fallback, no el camino primario |

`llama-3.3-70b-versatile` desaparece del código: ya no existe en la cuenta y su presencia es la causa
directa de las tres etapas caídas.

### 5. Presupuesto de salida del refiner

`max_tokens: 8192` no da para reemitir un transcript de ~58 000 caracteres (~15 000 tokens). Con
`gpt-oss-120b` el techo es 65 536, así que se sube el presupuesto y se mantiene la guarda de fidelidad
existente (si se pierde más del 30 % de las marcas `[MM:SS]`, se conserva el crudo). El refiner no se
trocea en esta feature: con el presupuesto corregido el caso real cabe; trocearlo sin necesidad
introduciría riesgo de costura entre fragmentos.

### 6. Detección: `bun run doctor:ai`

Un comando que hace llamadas **reales** y mínimas a cada etapa y reporta OK/fallo con el motivo del
proveedor, con código de salida distinto de cero si algo falla. Es lo que convierte una avería silenciosa
en algo que se ve en un comando. Se implementa como script del worker, siguiendo el patrón ya existente de
`refineDictionary.ts`.

## Ficheros afectados

| Fichero | Cambio |
|---|---|
| `apps/worker/src/services/aiModels.ts` | **nuevo** — resolución de modelos desde entorno |
| `apps/worker/src/services/transcriptionInput.ts` | **nuevo** — planificación pura de entrada y fusión de fragmentos |
| `apps/worker/src/services/audioPreprocessing.ts` | **nuevo** — ffprobe/ffmpeg: extraer, comprimir, trocear, limpiar |
| `apps/worker/src/services/gemini.ts` | modelo desde entorno, presupuesto de salida, formato con dos puntos |
| `apps/worker/src/services/speakerAttribution.ts` | modelo desde entorno |
| `apps/worker/src/services/groq.ts` | modelo de ASR desde entorno |
| `apps/worker/src/services/meetingAiProcessingService.ts` | preparar audio y fusionar en `transcribeRecording` |
| `apps/worker/src/scripts/doctorAi.ts` | **nuevo** — comprobación de salud de las etapas |
| `apps/__tests__/worker/services/*` | tests de los tres módulos puros y del formato |
| `README.md`, `.env.*.example`, `package.json` (worker y raíz) | variables nuevas y comando doctor |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El troceo corta una palabra | Solapamiento configurable; el test fija que los fragmentos se solapan |
| Los timestamps se desalinean al fusionar | El desplazamiento por inicio de fragmento es lógica pura con test |
| ffmpeg no está disponible donde corre el worker | Ya es dependencia dura del worker (graba con él); si falta, la preparación falla con mensaje explícito y el pipeline cae a `transcription_error`, no a un fichero corrupto |
| Subir el presupuesto de salida dispara el coste | El ASR y el resumen ya se facturaban; el refiner sólo gasta si el modelo reemite el texto, que es su trabajo |
| `gpt-oss-120b` es de razonamiento y gasta tokens antes de responder | Verificado con llamada real; el presupuesto por defecto es holgado y el modelo es configurable |

## Verificación

1. Tests puros en rojo → verde (`aiModels`, `transcriptionInput`, formato).
2. `bun test apps/__tests__ --isolate` sin regresiones.
3. `bun run typecheck`, `bun run lint`, `bun run build:web`.
4. **Integración real**: el pipeline completo sobre `~/Desktop/input.mp4` (53,5 min) debe producir
   transcripción con marcas de tiempo, hablantes asignados y resumen, sin enviar el vídeo al proveedor.
5. `bun run doctor:ai` debe reportar las cuatro etapas y salir con 0.
6. Revisión de frontera (Astra) del diff antes de cerrar.
