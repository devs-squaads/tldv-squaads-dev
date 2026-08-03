# Diseño: Diarización + Diccionario de Correcciones + Auto-Refinamiento

## Enfoque Técnico

Tres capas, sin cambios de schema y con fallback seguro en cada paso:

1. **Diarización**: `TranscriptionSegment` gana `speaker?: string`. Deepgram implementa por fin
   `transcribeDetailed` (agrupa `words[].speaker` en turnos con `Participante N`). Para proveedores sin
   speakers (Groq), un nuevo `speakerAttribution.ts` re-etiqueta los segmentos con LLM (Groq → Gemini,
   mismo patrón de fallback que el refiner), por chunks de ~25K chars, con parseo robusto de
   `Nombre [MM:SS]: texto` y fallback silencioso al formato actual si falla. `formatTimestampedTranscript`
   (gemini.ts) serializa `Nombre [MM:SS]: texto` cuando hay speaker.
2. **Diccionario de correcciones**: parsing dual en `transcriptionSettings.ts`
   (`parseDictionaryPairs` — líneas `"a" => "b"` y JSON de pares, compat con términos planos). El refiner
   recibe los pares como correcciones obligatorias y el pipeline aplica `applyDictionaryPairs`
   (reemplazo por límite de palabra unicode, case-insensitive, función de reemplazo a prueba de `$`) sobre
   el texto serializado ANTES del LLM: una corrección conocida se aplica aunque el LLM falle.
3. **Auto-refinamiento**: `dictionaryRefinement.ts` (shared, puro) porta `refine_dictionary.py`:
   `analyzeRawVsClean` (deltas de frecuencia, muletillas, similitud ≤2 chars/substring, scoring) y
   `mergeCandidateCounts` (acumulación con hits). Un `DictionaryCandidateRepository` guarda los candidatos
   en la tabla `settings` (JSON). `dictionaryCandidateCollection.ts` engancha el recolector tras el
   refinado en `meetingWorkerService` (try/catch — nunca rompe el pipeline). El CLI
   `apps/worker/src/scripts/refineDictionary.ts` (`bun run dictionary:refine`) reporta y con `--commit`
   promueve al diccionario.

## Decisiones de Arquitectura

| Decisión | Elección | Alternativas consideradas | Justificación |
|---|---|---|---|
| Almacenamiento del texto diarizado | Se guarda en `meetings.raw_transcription` (columna existente), texto plano con `Nombre [MM:SS]:` | Columna nueva / tabla de segmentos | Cero migraciones; la UI, el share y el chat ya consumen ese texto. El parseo estructurado puede reconstruirse con la convención de formato |
| Atribución de hablantes Groq | LLM (Groq llama-3.3-70b → Gemini flash-lite fallback), por chunks, reetiqueta los segmentos originales | Embeddings de voz / diarización acústica | Sin dependencias nuevas ni coste de infra; patrón ya probado en `diarize_llm.py`. Fallback silencioso si falla |
| Diccionario de pares | `settings` JSON existente (`transcription_dictionary`), parsing dual (pares + términos planos) | Tabla nueva `dictionary_entries` | Compatibilidad total con la UI actual; el textarea de Settings acepta la sintaxis de pares sin cambios de UI estructurales |
| Aplicación determinista de pares | `applyDictionaryPairs` con límites de palabra unicode `(?<!\p{L}...)` + case-insensitive, ANTES del LLM | Solo instrucción al LLM | La corrección se aplica aunque el LLM falle o alucine; los límites de palabra evitan sobre-correcciones parciales |
| Persistencia de candidatos | `settings` key `transcription_dictionary_candidates` (JSON `{wrong, correct, hits}[]`, máx 200) | Tabla dedicada | Mismo mecanismo que el diccionario; cero migraciones |
| Recolección en pipeline | Tras el refinado en `meetingWorkerService`, try/catch + console.warn | Cron externo sobre la DB | Recolecta siempre (cada reunión aporta pares raw/clean frescos) sin infraestructura extra |
| CLI de promoción | `bun run dictionary:refine` (worker) con `--commit` y modo `--raw/--clean` por ficheros | Endpoint admin en web | Reproduce el flujo validado de `refine_dictionary.py`; usable en cron |

## Riesgos y mitigaciones

- **Coste de LLM en atribución**: activable/desactivable con `SPEAKER_ATTRIBUTION_ENABLED` (default true);
  fallback silencioso sin coste si falla antes de llamar (sin key configurada).
- **Atribución imperfecta**: el formato sigue siendo válido sin speakers; el refiner preserva etiquetas
  si las hay. La validación de timestamps existente (ratio ≥ 70%) sigue protegiendo el refinado.
- **Over-replace del par determinista**: límites de palabra unicode + longitud mínima 2 + decisión del
  usuario al definir el par; los pares son explícitos, no automáticos.
- **Ruido en candidatos**: umbrales (diff ≥ 2, rawCount ≥ 2, no muletilla, len > 3) + dedup contra
  pares existentes; el commit es manual (`--commit`), nunca automático.
