# ADR 0001 · Worker de development en Railway (con bucket y Supabase dedicados)

**Estado:** aceptada — implementada (16/07/2026)
**Feature:** [`spec/features/006-worker-railway-dev/`](../../spec/features/006-worker-railway-dev/spec.md)

> **Actualización operativa (16/07/2026):** la decisión histórica de comenzar con deploy manual queda
> reemplazada por CD main-only de Railway, condicionado por `CI / validate`. También se retiraron los
> workflows y el script VPS. La arquitectura y el cierre de Feature 006 no cambian.

## Contexto

El worker-dev vivía en el VPS de Squaads (Docker Compose + `deploy.sh` por SSH + GitHub Actions en push a
`dev`). Este repo (`tldv-squaads-dev`) no tiene acceso al VPS: los workflows fallan por secrets ausentes,
el MinIO del VPS solo expone la consola (no la API S3) y no hay forma de operar el host. Mantener el
ambiente de desarrollo atado a esa infraestructura era fricción pura.

## Decisión

1. **Worker-dev en Railway** — proyecto `TLDV-DEV`, environment `dev-remote`, servicio `worker`.
   Build desde `Dockerfile.worker` (builder DOCKERFILE), config versionada en [`railway.json`](../../railway.json)
   y upload filtrado por [`.railwayignore`](../../.railwayignore). Deploy vía CD de Railway (main-only,
   condicionado por `CI / validate`); la activación completa de autodeploy sigue pendiente de las gates
   operativas — ver [`docs/deployment.md`](../deployment.md) → "Activación segura".
2. **Storage en bucket S3-compatible de Railway** (`tldv-meetings-dev-wlwoxrq`, endpoint
   `https://t3.storageapi.dev`) — pivot desde el MinIO del VPS, cuya API S3 no es alcanzable. Sin cambios
   de código: el `S3StorageProvider` existente funciona tal cual.
3. **Base de datos dedicada en Supabase para dev** (project ref `ljerzkktmzrpiwsahkvp`) — separa la cola
   de dev de la del VPS/producción; garantiza que **solo** el worker de Railway pollea esta cola (el
   cutover no requería tocar el VPS).
4. **Web en Vercel, aparte** — ver [`docs/deployment.md`](../deployment.md). La única intersección: en Vercel,
   `WORKER_INTERNAL_BASE_URL=https://worker-dev-remote.up.railway.app`.

## Consecuencias

- El worker de **producción** sigue intacto en el VPS (repo original). Este ADR aplica solo al ambiente dev.
- `deploy.sh` y `.github/workflows/deploy-{development,production}.yml` (VPS) ya fueron eliminados de
  este repo. En su lugar existe `.github/workflows/ci.yml` (check `CI / validate`) más `railway.json`
  como base del CD de Railway.
- El worker tiene CD configurado (main-only, gated por CI) pero el autodeploy aún no está activado hasta
  completar las gates operativas descritas en `docs/deployment.md`; la web sí tiene auto-deploy (Vercel).
- Validado end-to-end el 16/07/2026: grabación real de Meet → MP4 en el bucket de Railway →
  transcripción (Groq) → resumen → `completed`, con reproducción y descarga desde la web.
