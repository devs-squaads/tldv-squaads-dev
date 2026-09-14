# 016 · Pipeline de IA funcional de extremo a extremo

**Estado:** spec (proposal confirmed)

## Propósito

Verificado con las claves reales el 2026-09-14, **tres de las cuatro etapas de IA del worker están
caídas** y la cuarta falla en cuanto la reunión es larga:

| Etapa | Estado real | Evidencia |
|---|---|---|
| Transcripción (Whisper/Groq) | Funciona **solo** con ficheros pequeños | `413 request_too_large` en 1,6 s con un MP4 de 53 min (375 MB) |
| Diarización (atribución LLM) | **Caída** | `404: The model 'llama-3.3-70b-versatile' does not exist` → fallback Gemini `429: monthly spending cap` |
| Refiner (diccionario/contexto) | **Caída** | Groq 404 → Gemini `429` |
| Resumen | **Caída** | Groq 404 → Gemini `429` |

Las tres caídas son **silenciosas por diseño** («fallback silencioso, nunca rompas el pipeline»), así que
el sistema degrada a un transcript sin hablantes, sin diccionario aplicado y sin resumen, sin avisar a
nadie. Esto explica lo que se vio en la demo del 2026-08-03 y por qué desplegar la 014 no habría bastado.

## Requirements

### Requirement: La transcripción no envía el vídeo crudo al proveedor

El worker NO DEBE enviar el fichero de vídeo a la API de ASR. DEBE extraer la pista de audio y
comprimirla antes de llamar al proveedor, y DEBE comprobar el tamaño resultante contra el límite del
proveedor.

#### Scenario: Una grabación larga se transcribe

- DADO un MP4 de 53 minutos y 375 MB
- CUANDO se prepara la entrada de transcripción
- ENTONCES se produce un fichero de audio de canal único a 16 kHz
- Y su tamaño queda por debajo del límite del proveedor
- Y el proveedor lo transcribe sin error de tamaño

#### Scenario: El audio extraído sigue siendo demasiado grande

- DADO un audio comprimido que supera el límite del proveedor
- CUANDO se prepara la entrada
- ENTONCES se parte en segmentos con solapamiento
- Y los segmentos se transcriben por separado
- Y los resultados se fusionan con sus marcas de tiempo desplazadas por el inicio de cada segmento

#### Scenario: El audio se limpia después

- DADO un fichero de audio temporal producido por la preparación
- CUANDO termina la transcripción, con éxito o con error
- ENTONCES el fichero temporal se borra

### Requirement: Los identificadores de modelo son configurables y los por defecto funcionan

Los identificadores de modelo NO DEBEN estar hardcodeados en los servicios. DEBEN resolverse desde
variables de entorno con valores por defecto **verificados contra las APIs reales**, y el valor por
defecto NO DEBE ser un modelo retirado.

#### Scenario: Sin variables configuradas se usan los valores verificados

- DADO un entorno sin `GROQ_TEXT_MODEL` ni `GROQ_TRANSCRIPTION_MODEL` ni `GEMINI_MODEL`
- CUANDO se resuelve la configuración de modelos
- ENTONCES el modelo de texto es uno disponible hoy en la cuenta de Groq
- Y el modelo de transcripción es el de ASR

#### Scenario: El operador cambia de modelo sin tocar código

- DADO `GROQ_TEXT_MODEL=deepseek-v4.1-flash`
- CUANDO se resuelve la configuración
- ENTONCES el modelo de texto es `deepseek-v4.1-flash`

### Requirement: El transcript serializado con hablante usa el formato del spec 014

`formatTimestampedTranscript` DEBE serializar `Nombre [MM:SS]: texto` (con dos puntos) cuando el segmento
lleva hablante, que es la convención de la 014, de la documentación del README y del pipeline de
referencia `clean_transcriptions`. Sin hablante DEBE seguir siendo `[MM:SS] texto`.

#### Scenario: Segmento con hablante

- DADO un segmento con `speaker: "Marta"` y `start: 75`
- CUANDO se serializa
- ENTONCES la línea es `Marta [01:15]: <texto>`

#### Scenario: Segmento sin hablante

- DADO un segmento sin `speaker` y `start: 75`
- CUANDO se serializa
- ENTONCES la línea es `[01:15] <texto>`

### Requirement: El refiner no puede truncar en silencio

La llamada al refiner DEBE tener presupuesto de salida suficiente para reemitir el transcript completo, y
la guarda de fidelidad DEBE seguir rechazando un refinado que pierda demasiadas marcas de tiempo.

#### Scenario: Un transcript largo sobrevive al refinado

- DADO un transcript de ~58 000 caracteres
- CUANDO se refina
- ENTONCES el presupuesto de salida es suficiente para reemitirlo entero
- Y si el resultado pierde más del 30 % de las marcas de tiempo, se conserva el original

### Requirement: Existe una comprobación de salud del pipeline de IA

El worker DEBE exponer un comando que compruebe **de verdad** (con llamadas reales) que cada etapa
responde: ASR, modelo de texto, refiner y resumen. Su salida DEBE decir qué etapa falla y por qué, para
que esta clase de avería silenciosa se detecte en un comando y no en una demo.

#### Scenario: Una etapa caída se reporta

- DADO un modelo de texto retirado
- CUANDO se ejecuta la comprobación
- ENTONCES la salida marca esa etapa como fallida con el motivo del proveedor
- Y el código de salida es distinto de cero

#### Scenario: Todo responde

- DADO un entorno con las claves y los modelos correctos
- CUANDO se ejecuta la comprobación
- ENTONCES todas las etapas se reportan como OK
- Y el código de salida es cero

## Fuera de alcance (declarado)

- **Sustituir el ASR por `gemini-3.5-transcribe` o `gemini-3.8-flash`**: la clave de Gemini tiene el tope
  de gasto mensual agotado, así que no se puede verificar hoy. La configuración de modelos queda lista
  para hacerlo con un cambio de variable cuando la persona levante el tope.
- **`deepseek-v4.1-flash`**: no hay credencial en el entorno ni ruta de acceso definida. Queda como valor
  configurable en cuanto se sepa por dónde se sirve.
- **Persistir el aviso de degradación en la base de datos**: requiere cambio de esquema. La visibilidad se
  cubre con la comprobación de salud y con logs etiquetados.
- **Diarización con nombres reales**: la 014 queda con `Participante N`; el cruce con
  `participantEmails` va en su propia feature.
