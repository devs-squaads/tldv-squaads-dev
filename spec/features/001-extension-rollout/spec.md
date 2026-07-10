# 001 · Rollout interno de la extensión

**Estado:** en curso

## Qué hace

Deja la extensión Chrome lista para usarse por compañeros en entornos compartidos (no solo en la máquina
local del autor): el ZIP interno real se distribuye y carga en cada entorno, el flujo de vinculación y uso
funciona end-to-end fuera de local, y el `manifest` apunta a un dominio real en lugar de hosts locales.

## Por qué

La extensión ya está construida y validada localmente, pero su rollout interno quedó como pendiente heredado
de la Fase 8. Sin esto, el equipo no puede probar ni usar la extensión en condiciones reales, y queda un
acoplamiento a `localhost` que bloquea cualquier uso compartido o demo.

## Criterios de aceptación

- [ ] El ZIP interno real (`apps/web/private-downloads/squaads-extension-internal.zip`) está cargado y
      operativo en cada entorno compartido con compañeros.
- [ ] El flujo end-to-end (invitar bot → vincular `linkToken` → estado en vivo) se valida con éxito en un
      entorno **no local**.
- [ ] El `manifest.json` de la extensión usa el dominio real desplegado; no quedan hosts `localhost` en los
      `host_permissions` ni en las URLs de API.
- [ ] El onboarding seguro (`POST /api/v1/extension/link-token` + `POST /api/v1/extension/connect`) responde
      correctamente desde el dominio real.

## Fuera de alcance

- Soporte multi-plataforma Meet/Teams/Zoom con adapters → ver backlog "Extensión multi-plataforma"
  (`../../../docs/extension.md`).
- Publicación en la Chrome Web Store (la distribución sigue siendo interna por ZIP).
