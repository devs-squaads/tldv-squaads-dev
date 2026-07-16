# 006 · Migrar el despliegue del worker a Railway (solo development)

**Estado:** implementado ✅ (16/07/2026 — ADR en `docs/adr/0001-worker-railway-dev.md`, contexto operativo en `docs/deployment.md`)

## Qué hace

Mueve el despliegue del worker del ambiente **development** desde el VPS propio (Docker Compose +
`deploy.sh` por SSH, disparado por GitHub Actions) hacia **Railway**, una PaaS de contenedores que
construye y corre el worker a partir de `Dockerfile.worker`. Desde el punto de vista operativo, el
worker-dev deja de vivir en el VPS y pasa a correr en un servicio de Railway con su propio dominio
público, alcanzando el mismo trabajo de siempre: reclama reuniones de la cola de dev, graba con
Puppeteer + FFmpeg, transcribe y resume.

La base de datos sigue en **Supabase** (misma cola de dev) y la web es un tema aparte (Vercel). El
**almacenamiento de video deja de usar el MinIO del VPS** — su API S3 no es alcanzable desde fuera del
VPS y no hay acceso para exponerla — y pasa a un **bucket S3-compatible de Railway**. El worker de
**producción** sigue intacto en el VPS.

Es una ronda de **infraestructura/configuración**, no de lógica de negocio: el objetivo es probar que
`Dockerfile.worker` buildea y corre en Railway vía `railway up` manual desde local, y que una grabación
de prueba llega hasta el final.

## Por qué

El worker-dev depende hoy de un VPS gestionado a mano (Docker Compose + `deploy.sh` por SSH + un
workflow de GitHub Actions). Migrarlo a Railway para development reduce la fricción operativa de ese
ambiente: build y deploy reproducibles desde un contenedor estándar, dominio y healthcheck gestionados
por la plataforma, y menos superficie de mantenimiento manual del host. Se hace primero solo en
development para validar el enfoque de forma aislada y determinística, sin arriesgar el worker de
producción.

El worker ya está preparado para correr fuera del VPS sin cambios de código: soporta la credencial de
Google como variable de entorno (`GOOGLE_SERVICE_ACCOUNT_JSON`, con fallback a
`GOOGLE_SERVICE_ACCOUNT_FILE`), expone `GET /health` en `WORKER_INTERNAL_PORT` (default 4000) para el
healthcheck, escribe el MP4 en `os.tmpdir()` y lo borra tras subir a S3 (no requiere volumen
persistente). Esto convierte la migración en un ejercicio de configuración, no de reescritura.

## Criterios de aceptación

_Todos verificables por integración/manual (esta feature cae en la excepción de validación
integración/manual de `AGENTS.md`: captura multimedia del worker con Puppeteer + FFmpeg)._

- [x] **Checkpoint S3 (hecho):** un `PutObject` contra el bucket de Railway responde OK — validado con
      round-trip PutObject/GetObject/DeleteObject usando el `S3StorageProvider` actual, sin cambios de
      código. El endpoint público del MinIO del VPS quedó descartado: sirve la consola, no la API S3, y no
      hay acceso al VPS para exponerla.
- [x] El servicio worker en Railway (proyecto `TLDV-DEV`, environment `dev-remote`) alcanza estado de
      deploy `SUCCESS` construyendo desde `Dockerfile.worker`. (Deploys `497ec914-…` y `a2e75bba-…`
      confirmados `SUCCESS`.)
- [x] `GET /health` responde `200` desde el dominio público que asigna Railway
      (`https://worker-dev-remote.up.railway.app`).
- [x] Solo el worker de Railway pollea la cola de dev: resuelto con una **Supabase dedicada para dev**
      (ref `ljer…`) a la que el worker viejo del VPS no apunta — no hizo falta tocar el VPS.
- [x] Una grabación de prueba llega a estado `completed`: MP4 subido al **bucket de Railway**
      (`tldv-meetings-dev-wlwoxrq`) + transcripción (Groq) + resumen generados; reproducción y descarga
      verificadas desde la web (16/07/2026).
- [x] Sin crashes de `/dev/shm` de Chromium en los logs a lo largo de varios deploys y grabaciones —
      no hizo falta `--disable-dev-shm-usage`.

## Fuera de alcance

- **Deploy/config del web en Vercel** (dominio `devs.squaads`, `vercel.json`, plan Hobby/Pro) — ya
  guiado en `docs/vercel-deploy-checklist.md`. Única intersección que sí se toca en esta ronda: repuntar
  `WORKER_INTERNAL_BASE_URL` (en Vercel) al nuevo dominio de Railway cuando el worker esté verde.
- **Worker de producción** — sigue en el VPS hasta que el dev en Railway esté probado.
- **GitHub integration / auto-deploy y apagar el workflow SSH** — ronda de CI aparte. Esta ronda solo
  usa `railway up` manual desde local.
- **Borrar `deploy.sh` y los workflows de despliegue** — no se eliminan; en la fase de documentación
  posterior solo se marcan como "inactivos para el worker de este repo -dev".
- **Tocar el VPS** — no se accede al VPS en absoluto; el almacenamiento se resuelve con un bucket de
  Railway, no con el MinIO del VPS. Las grabaciones viejas de dev que quedaron en el MinIO se abandonan.
- **Instalar el MCP de Railway para Claude Code.**
