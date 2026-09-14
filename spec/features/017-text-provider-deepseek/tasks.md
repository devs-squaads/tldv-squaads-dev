# Tareas · 017 Proveedor de texto DeepSeek

## Pronóstico de Carga de Review

| Campo | Valor |
|---|---|
| Líneas cambiadas estimadas | ~600-750 (contrato + 2 proveedores + factory + refactor de 2 servicios + CLI + tests + docs) |
| Riesgo del presupuesto de 400 líneas | Alto |
| PRs encadenados recomendados | Sí, dos: (A) contrato + proveedores + factory con tests; (B) refactor de `gemini.ts` y `speakerAttribution.ts` al contrato |
| Estrategia de entrega | Dos PRs encadenados feature → dev |

## Unidades de Trabajo

| Unidad | Objetivo | Comando de test focalizado |
|---|---|---|
| 0 | **Regla: eliminar todo `max_tokens` del repo** (worker y chat de la web) y derogar `resolveTextOutputBudget` con sus tests | `bun test apps/__tests__/worker/services/ai-models.test.ts` |
| 1 | Contrato `TextGenerationProvider` + `TextGenerationRequest` con modo de razonamiento | `bun test apps/__tests__/worker/integrations/text-provider-contract.test.ts` |
| 2 | `DeepSeekTextProvider` (SDK `openai`, baseURL DeepSeek, `thinking` off/auto) | `bun test apps/__tests__/worker/integrations/deepseek-text-provider.test.ts` |
| 3 | `GeminiTextProvider` | `bun test apps/__tests__/worker/integrations/gemini-text-provider.test.ts` |
| 4 | `TextGenerationProviderFactory` con `TEXT_PROVIDER`, autodetección y respaldo | `bun test apps/__tests__/worker/integrations/text-provider-factory.test.ts` |
| 5 | Presupuesto de salida corregido para modelos que razonan | `bun test apps/__tests__/worker/services/ai-models.test.ts` |
| 6 | Refactor de `gemini.ts` (resumen + refiner) al contrato, sin ramas por proveedor | `bun test apps/__tests__/worker/services/` |
| 7 | Refactor de `speakerAttribution.ts` al contrato, con censo y guardas intactos | `bun test apps/__tests__/worker/services/speaker-attribution-fidelity.test.ts` |
| 8 | `doctorAi.ts` reportando el proveedor de texto real | `bun run doctor:ai` |
| 9 | Docs: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `TEXT_PROVIDER` en README y `.env.*.example` | — |
| 10 | Suites completas | `bun run test` · `lint` · `typecheck` · `build:web` |
| 11 | E2E real sobre la grabación de 53,5 min, comparado con la 016 | pipeline completo |
| 12 | Revisión de frontera (Astra) | `fusion.mjs ask --rol revision` |

## Checklist de aceptación (spec 017)

- [ ] **Ninguna llamada a un LLM del repo fija `max_tokens`** (ni `max_completion_tokens` ni `maxOutputTokens`)
- [ ] `resolveTextOutputBudget` eliminada, con sus tests sustituidos por la regla
- [ ] Existe `TextGenerationProvider` con implementaciones DeepSeek y Gemini y una factory
- [ ] `gemini.ts` y `speakerAttribution.ts` no contienen ninguna referencia a Groq ni ramas por proveedor
- [ ] `TEXT_PROVIDER` selecciona el proveedor; sin él, autodetección DeepSeek → Gemini
- [ ] Un primario que falla cae al respaldo si está configurado
- [ ] Las tareas de copia (atribución y refiner) piden razonamiento desactivado
- [ ] El resumen pide razonamiento automático
- [ ] El presupuesto de salida no trunca un transcript de ~6000 caracteres con DeepSeek
- [ ] Una respuesta truncada se marca y la guarda de la 016 conserva el contenido
- [ ] `DEEPSEEK_MODEL` configurable; un modelo retirado se descarta con aviso
- [ ] `bun run doctor:ai` reporta DeepSeek y las cuatro etapas OK con exit 0
- [ ] E2E real: no menos de 826 segmentos, 826/826 con hablante y cobertura completa
- [ ] Suites: `test`, `lint`, `typecheck`, `build:web` en verde
- [ ] Revisión de frontera con veredicto `aprobar`
- [ ] Nada del contrato de despliegue tocado; sin cambios de esquema
- [ ] La clave real no aparece en ningún fichero versionado
