# Tareas · 015 Cierre de la superficie de autorización

## Pronóstico de Carga de Review

| Campo | Valor |
|---|---|
| Líneas cambiadas estimadas | ~180-240 (5 rutas + 1 módulo puro + tests) |
| Riesgo del presupuesto de 400 líneas | Bajo |
| PRs encadenados recomendados | No |
| Estrategia de entrega | Un solo PR feature → dev |

## Unidades de Trabajo

| Unidad | Objetivo | Comando de test focalizado |
|---|---|---|
| 1 | Módulo puro `lib/apiAuthGuards.ts`: allowlist de claves editables + decisión de autenticación | `bun test apps/__tests__/web/lib/api-auth-guards.test.ts` |
| 2 | `GET /api/meetings/[id]`: scoping de la rama de sesión, rama máquina intacta | `bun test apps/__tests__/web/routes/meetings-id-route.test.ts` |
| 3 | `GET /api/v1/extension/meetings/[id]`: scoping por `userId` del token | `bun test apps/__tests__/web/routes/extension-meetings-id-route.test.ts` |
| 4 | `POST /api/settings`: sesión + allowlist | `bun test apps/__tests__/web/routes/settings-route-authz.test.ts` |
| 5 | `/api/settings/google-credentials`: sesión en GET/POST/DELETE | `bun test apps/__tests__/web/routes/google-credentials-route-authz.test.ts` |
| 6 | `GET /api/bot/poll`: `assertPrivateApiAuthorized` | `bun test apps/__tests__/web/routes/bot-poll-route-authz.test.ts` |
| 7 | Suites completas | `bun run test` · `bun run lint` · `bun run typecheck` · `bun run build:web` |
| 8 | Revisión de frontera (Astra) del diff completo | `node ~/.agents/skills/fusion-astra/fusion.mjs ask --rol revision` |

## Checklist de aceptación (spec 015)

- [ ] `GET /api/meetings/:id` devuelve 404 a una sesión sin ownership ni grant, y 200 al Owner y al grantee
- [ ] `GET /api/meetings/:id` sigue devolviendo 200 con `Bearer API_ROUTE_SECRET` sin ownership
- [ ] Las respuestas 404 no incluyen `rawTranscription`, `summary` ni `recordingFilePath`
- [ ] `GET /api/v1/extension/meetings/:id` devuelve 404 con un token ajeno y 200 con el del Owner
- [ ] Ninguna URL firmada se genera cuando la reunión no es visible
- [ ] `POST /api/settings` devuelve 401 sin sesión, sin tocar el repositorio
- [ ] `POST /api/settings` rechaza con 400 una clave fuera de la allowlist, sin escribir
- [ ] `POST /api/settings` sigue guardando `monitor_email` con sesión válida
- [ ] `GET`/`POST`/`DELETE` de google-credentials devuelven 401 sin sesión y no tocan el disco
- [ ] `GET /api/bot/poll` devuelve 401 sin secreto y 200 con él
- [ ] Los tests existentes de storage keys siguen verdes (actualizados con `id` en la sesión)
- [ ] Suites: `bun run test`, `lint`, `typecheck`, `build:web` en verde
- [ ] Revisión de frontera con veredicto `aprobar`
- [ ] Nada del contrato de despliegue (`Dockerfile.*`, `docker-compose*.yml`, `railway.json`, workflows) tocado
- [ ] Sin cambios de esquema ni migraciones
