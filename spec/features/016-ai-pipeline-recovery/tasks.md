# Tareas · 016 Pipeline de IA funcional de extremo a extremo

## Pronóstico de Carga de Review

| Campo | Valor |
|---|---|
| Líneas cambiadas estimadas | ~420-520 (3 módulos nuevos + 1 CLI + 4 servicios tocados + tests + docs) |
| Riesgo del presupuesto de 400 líneas | Medio |
| PRs encadenados recomendados | No (una avería con una causa común: modelos retirados + payload sin preparar) |
| Estrategia de entrega | Un solo PR feature → dev |

## Unidades de Trabajo

| Unidad | Objetivo | Comando de test focalizado |
|---|---|---|
| 1 | `aiModels.ts` puro: resolución desde entorno, defaults verificados, detección de modelo retirado | `bun test apps/__tests__/worker/services/ai-models.test.ts` |
| 2 | `transcriptionInput.ts` puro: plan de entrada (troceo) y fusión con desplazamiento + dedupe de solape | `bun test apps/__tests__/worker/services/transcription-input.test.ts` |
| 3 | Formato `Nombre [MM:SS]: texto` con dos puntos | `bun test apps/__tests__/worker/services/format-timestamped-transcript.test.ts` |
| 4 | `audioPreprocessing.ts`: ffprobe/ffmpeg, extracción, compresión, troceo y limpieza | integración (ffmpeg real) |
| 5 | Wiring: `transcribeRecording` prepara el audio y fusiona fragmentos | `bun test apps/__tests__/worker/services/meeting-worker-service.test.ts` |
| 6 | Modelos desde entorno en `groq.ts`, `gemini.ts` y `speakerAttribution.ts`; presupuesto de salida del refiner | tests focalizados de 1 y 3 |
| 7 | `scripts/doctorAi.ts` + scripts npm (worker y raíz) | `bun run doctor:ai` |
| 8 | Docs: README + `.env.*.example` con las variables nuevas y el comando | — |
| 9 | Suites completas | `bun run test` · `bun run lint` · `bun run typecheck` · `bun run build:web` |
| 10 | Integración real sobre la grabación de 53,5 min | `bun run doctor:ai` + pipeline completo |
| 11 | Revisión de frontera (Astra) del diff | `fusion.mjs ask --rol revision` |

## Checklist de aceptación (spec 016)

- [ ] `resolveAiModels` devuelve los defaults verificados con un entorno vacío
- [ ] `resolveAiModels` respeta `GROQ_TEXT_MODEL`, `GROQ_TRANSCRIPTION_MODEL` y `GEMINI_MODEL`
- [ ] Un modelo retirado configurado no se usa: cae al default con aviso
- [ ] `planTranscriptionInput` no trocea cuando el audio cabe en el límite
- [ ] `planTranscriptionInput` trocea con solapamiento cuando no cabe
- [ ] `mergeChunkSegments` desplaza las marcas de tiempo por el inicio de cada fragmento
- [ ] `mergeChunkSegments` descarta los segmentos duplicados del solape
- [ ] El transcript sin hablante sigue siendo `[MM:SS] texto`
- [ ] El transcript con hablante es `Nombre [MM:SS]: texto`
- [ ] `transcribeRecording` no entrega el vídeo al proveedor: entrega audio
- [ ] Los ficheros temporales de audio se borran siempre
- [ ] `llama-3.3-70b-versatile` no aparece en ningún servicio
- [ ] El presupuesto de salida del refiner permite reemitir un transcript de ~58 000 caracteres
- [ ] `bun run doctor:ai` reporta las cuatro etapas y sale con 0
- [ ] El pipeline completo sobre `~/Desktop/input.mp4` produce transcripción, hablantes y resumen
- [ ] Suites: `bun run test`, `lint`, `typecheck`, `build:web` en verde
- [ ] Revisión de frontera con veredicto `aprobar`
- [ ] Nada del contrato de despliegue tocado; sin cambios de esquema
