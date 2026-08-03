# Tareas: Diarización + Diccionario de Correcciones + Auto-Refinamiento

## Pronóstico de Carga de Review

| Campo | Valor |
|---|---|
| Líneas cambiadas estimadas | ~1100-1500 (2 servicios nuevos + 2 módulos puros + 1 provider ampliado + 3 ficheros tocados + CLI + ~6 ficheros de test + spec/docs) |
| Riesgo del presupuesto de 400 líneas | Alto |
| PRs encadenados recomendados | No (una feature cohesiva con fallback seguro; los tests la cubren) |
| Estrategia de entrega | Un solo PR feature → dev |

## Unidades de Trabajo

| Unidad | Objetivo | Comando de test focalizado | Runtime harness |
|---|---|---|---|
| 1 | Módulo puro shared: `dictionaryRefinement.ts` (`applyDictionaryPairs`, `analyzeRawVsClean`, `mergeCandidateCounts`, muletillas) | `bun test apps/__tests__/worker/shared/dictionary-refinement.test.ts` | N/A — lógica pura |
| 2 | Parsing dual del diccionario en `transcriptionSettings.ts` (`dictionaryPairs` + compat términos) | `bun test apps/__tests__/worker/shared/transcription-settings.test.ts` | N/A |
| 3 | Contrato `TranscriptionSegment.speaker` + Deepgram `transcribeDetailed` (agrupación de turnos) | `bun test apps/__tests__/worker/services/deepgram-speakers.test.ts` | N/A (función pura de agrupación exportada) |
| 4 | `speakerAttribution.ts` (prompt, chunking, parseo `Nombre [MM:SS]:`, fallback) | `bun test apps/__tests__/worker/services/speaker-attribution.test.ts` | N/A (LLM mockeado) |
| 5 | Wiring: `meetingAiProcessingService` (hook de atribución + refiner con pares) + `gemini.ts` (formato speaker, prompt refiner con pares) | `bun test apps/__tests__/worker/services/speaker-attribution.test.ts` | N/A |
| 6 | `DictionaryCandidateRepository` + `dictionaryCandidateCollection.ts` (acumulación) | `bun test apps/__tests__/worker/services/dictionary-candidate-collection.test.ts` | Repo mockeado |
| 7 | Hook en `meetingWorkerService` (recolectar tras refinado) + ampliar harness del test existente | `bun test apps/__tests__/worker/services/meeting-worker-service.test.ts` | N/A |
| 8 | CLI `apps/worker/src/scripts/refineDictionary.ts` + scripts npm (worker + raíz) | `bun run dictionary:refine --help` | N/A |
| 9 | Docs: README (sintaxis pares, `SPEAKER_ATTRIBUTION_ENABLED`, CLI), `.env.*.example`, hint UI `TranscriptionContextCard` | — | `bun run dev:web` (visual opcional) |
| 10 | Suites completas: `bun run typecheck` · `bun run lint` · `bun test apps/__tests__` · `bun run build:web` | — | CI validate |

## Checklist de aceptación (spec 014)

- [ ] `TranscriptionSegment.speaker?: string` presente en el contrato
- [ ] Deepgram `transcribeDetailed` devuelve turnos con `Participante N` (words → turns)
- [ ] Atribución LLM para segmentos sin speaker, con fallback silencioso
- [ ] `formatTimestampedTranscript` serializa `Nombre [MM:SS]: texto` con speaker
- [ ] `parseDictionaryPairs` acepta líneas `"a" => "b"` y JSON de pares; términos planos intactos
- [ ] `applyDictionaryPairs` determinista antes del LLM en `refineTranscriptionResult`
- [ ] Recolector de candidatos enganchado tras el refinado (try/catch)
- [ ] `bun run dictionary:refine` reporta y `--commit` promueve al diccionario (dedup)
- [ ] README + `.env.*.example` documentan `SPEAKER_ATTRIBUTION_ENABLED` y sintaxis de pares
- [ ] Suites: typecheck, lint, tests, build en verde
