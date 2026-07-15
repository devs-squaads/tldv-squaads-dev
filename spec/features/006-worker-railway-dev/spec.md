# 006 · Migrar el despliegue del worker a Railway (solo development)

**Estado:** propuesta

## Qué hace

Mueve el despliegue del worker del ambiente **development** desde el VPS propio (Docker Compose +
`deploy.sh` por SSH, disparado por GitHub Actions) hacia **Railway**, una PaaS de contenedores que
construye y corre el worker a partir de `Dockerfile.worker`. Desde el punto de vista operativo, el
worker-dev deja de vivir en el VPS y pasa a correr en un servicio de Railway con su propio dominio
público, alcanzando el mismo trabajo de siempre: reclama reuniones de la cola de dev, graba con
Puppeteer + FFmpeg, transcribe y resume.

El resto del sistema no cambia: la base de datos sigue en **Supabase** (misma cola de dev), el
almacenamiento de video sigue en el **MinIO del VPS** (se reutiliza su endpoint público, sin tocar el
VPS) y la web es un tema aparte (Vercel). El worker de **producción** sigue intacto en el VPS.

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

- [ ] **Checkpoint S3:** un `PutObject` de prueba contra el endpoint público de MinIO
      (`S3_PUBLIC_ENDPOINT`) responde OK. Si falla, se frena la ronda: habría que exponer la API S3 de
      escritura, lo que contradice "el VPS/S3 no se toca".
- [ ] El servicio worker en Railway (proyecto `TLDV-DEV`, environment `dev-remote`) alcanza estado de
      deploy `SUCCESS` construyendo desde `Dockerfile.worker`.
- [ ] `GET /health` responde `200` desde el dominio público que asigna Railway.
- [ ] El worker-dev del VPS queda parado: solo el worker de Railway pollea la cola de dev en Supabase.
- [ ] Una grabación de prueba corta llega a estado `completed`: MP4 subido al S3 del VPS +
      transcripción + resumen generados.
- [ ] Sin crashes de `/dev/shm` de Chromium en los logs. Si aparecieron, se confirman resueltos tras
      aplicar `--disable-dev-shm-usage` a los args de Puppeteer.

## Fuera de alcance

- **Deploy/config del web en Vercel** (dominio `devs.squaads`, `vercel.json`, plan Hobby/Pro) — ya
  guiado en `docs/vercel-deploy-checklist.md`. Única intersección que sí se toca en esta ronda: repuntar
  `WORKER_INTERNAL_BASE_URL` (en Vercel) al nuevo dominio de Railway cuando el worker esté verde.
- **Worker de producción** — sigue en el VPS hasta que el dev en Railway esté probado.
- **GitHub integration / auto-deploy y apagar el workflow SSH** — ronda de CI aparte. Esta ronda solo
  usa `railway up` manual desde local.
- **Borrar `deploy.sh` y los workflows de despliegue** — no se eliminan; en la fase de documentación
  posterior solo se marcan como "inactivos para el worker de este repo -dev".
- **Tocar el VPS o el MinIO** — se reutiliza el endpoint público de S3 tal cual está.
- **Instalar el MCP de Railway para Claude Code.**
