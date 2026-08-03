# 014 · Diarización + Diccionario de Correcciones + Auto-Refinamiento

**Estado:** spec (proposal confirmed)

## Propósito

Hoy la transcripción se serializa como `[MM:SS] texto` — **sin nombres de hablante** — y el diccionario
de transcripción es una lista plana de términos (keywords de ASR) que no corrige errores recurrentes.
Esta feature entrega tres capacidades que cierran el gap frente a tl·dv y a nuestro pipeline interno:

1. **Diarización**: cada segmento lleva un hablante (`Participante 1`, nombre inferido por LLM…). El
   formato serializado pasa a `Nombre [MM:SS]: texto` (convención de `clean_transcriptions`).
2. **Diccionario de correcciones**: el diccionario admite pares `errónea => correcta` además de
   keywords planas. El refiner los aplica (paso determinista + instrucción al LLM) para que los errores
   conocidos se corrijan siempre.
3. **Auto-refinamiento**: tras cada reunión, un recolector compara la transcripción cruda con la
   refinada, detecta patrones de error recurrentes y acumula candidatos de corrección; un CLI
   (`bun run dictionary:refine`) revisa el reporte y con `--commit` promueve los mejores candidatos al
   diccionario. El sistema mejora solo con el tiempo.

## Requirements

### Requirement: Los segmentos de transcripción llevan hablante opcional

El contrato `TranscriptionSegment` DEBE ganar un campo `speaker?: string`. El proveedor Deepgram DEBE
implementar `transcribeDetailed` (hoy solo `transcribe`), extrayendo `words[].speaker` del resultado
`diarize: true` y agrupando palabras consecutivas del mismo hablante en turnos. Cuando los segmentos
vienen sin hablante (Groq Whisper no diariza) y `SPEAKER_ATTRIBUTION_ENABLED !== "false"`, el worker
DEBE ejecutar un paso de atribución LLM (Groq primero, Gemini como fallback — mismo patrón que el
refiner) que etiquete cada segmento con un hablante. Si la atribución falla, la transcripción DEBE
conservar el formato actual sin hablantes (nunca romper el pipeline).

#### Scenario: Deepgram produce turnos con hablante

- DADO una grabación transcrita con Deepgram (`diarize: true`)
- CUANDO se llama a `transcribeDetailed`
- ENTONCES los segmentos devueltos tienen `speaker` (`Participante 1`, `Participante 2`, …)
- Y `formatTimestampedTranscript` serializa `Participante 1 [MM:SS]: texto`

#### Scenario: Groq produce segmentos sin hablante y la atribución LLM funciona

- DADO una grabación transcrita con Groq Whisper (segmentos sin `speaker`)
- CUANDO el pipeline corre con `SPEAKER_ATTRIBUTION_ENABLED` no-false
- ENTONCES cada segmento queda etiquetado con un hablante antes del refinado

#### Scenario: La atribución LLM falla

- DADO una grabación transcrita con Groq y el paso de atribución fallando (timeout/error)
- CUANDO el pipeline corre
- ENTONCES la transcripción se serializa en el formato `[MM:SS] texto` actual, sin error

### Requirement: El diccionario admite pares errónea => correcta

El parsing del diccionario (`parseTranscriptionDictionary` / `parseDictionaryPairs`) DEBE aceptar, además
de términos planos y JSON de términos, líneas `"errónea" => "correcta"` y JSON de pares
`[{"wrong": "...", "correct": "..."}]`. `TranscriptionSettings` DEBE exponer `dictionaryPairs`; los
`dictionaryTerms` (keywords de ASR) DEBEN seguir derivándose de la parte `correct` de cada par + términos
planos (compatibilidad total con lo existente). El refiner DEBE recibir los pares como correcciones
obligatorias y, además, el pipeline DEBE aplicarlos de forma determinista (reemplazo por límite de
palabra, insensible a mayúsculas) antes de la llamada LLM, de modo que una corrección conocida se
aplique aunque el LLM falle.

#### Scenario: Usuario define un par de corrección

- DADO diccionario `"tldv" => "tl·dv"` guardado en settings
- CUANDO se refina una transcripción que contiene "tldv"
- ENTONCES el texto final contiene "tl·dv" (aunque el LLM fallara, el paso determinista lo aplicó)

#### Scenario: Compatibilidad con diccionarios existentes

- DADO un diccionario plano preexistente ("Squaads\nKubernetes")
- CUANDO se parsea
- ENTONCES `dictionaryTerms` es idéntico al comportamiento actual y `dictionaryPairs` es vacío

### Requirement: Auto-refinamiento del diccionario

Tras el refinado de cada reunión, el pipeline DEBE analizar la transcripción cruda vs la refinada
(`analyzeRawVsClean`): palabras con caída de frecuencia >= 2, longitud > 3 y no-muletilla, con pareja
similar en el texto limpio, puntuadas como candidatos. Los candidatos DEBEN acumularse en settings
(`transcription_dictionary_candidates`) con contador de hits, sin duplicados. El CLI
`bun run dictionary:refine` DEBE listar el reporte; con `--commit` DEBE promover los candidatos de más
hits al diccionario (dedup contra pares existentes). El recolector NUNCA DEBE poder romper el pipeline
(try/catch, warning en logs).

#### Scenario: Reunión con error recurrente detectado

- DADO una transcripción cruda con "SQUADS" repetido y una refinada con "SQUAADS"
- CUANDO el pipeline recolecta candidatos
- ENTONCES aparece el candidato `SQUADS => SQUAADS` con hits >= 2 en `transcription_dictionary_candidates`

#### Scenario: El CLI promueve candidatos

- DADO candidatos acumulados y `bun run dictionary:refine --commit`
- CUANDO el CLI corre
- ENTONCES los candidatos top se añaden como pares al diccionario y los candidatos se limpian

## Fuera de alcance

- Diarización por embeddings de voz (solo atribución LLM y speakers de Deepgram).
- Cambios de schema en `meetings` (el texto diarizado se guarda en `raw_transcription` existente).
- UI de gestión de candidatos (el CLI cubre el flujo; la UI actual de Settings sigue sirviendo para
  editar contexto y diccionario manualmente, ahora con sintaxis de pares).
