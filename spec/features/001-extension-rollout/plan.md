# 001 · Rollout interno de la extensión — Plan

_Cómo se implementa lo descrito en `spec.md`. Debe respetar la `constitution/`._

## Enfoque

La extensión ya tiene su fuente de verdad en `apps/extension/src` y un build que genera el ZIP interno. El
trabajo es de **distribución y configuración por entorno**, no de motor: regenerar el ZIP, distribuirlo,
parametrizar el dominio (sin hardcodear hosts) y validar el onboarding real contra el `web` desplegado.
Respeta API-first: la extensión solo consume `/api/v1/extension/*`, sin lógica de dominio propia.

## Implementación

1. Regenerar el artefacto con `bun run extension:build` → `apps/web/private-downloads/squaads-extension-internal.zip`.
2. Parametrizar el dominio de API/host de la extensión (`apps/extension/src` + `manifest.json`) para que el
   `host_permissions` y las URLs salgan de configuración, no de `localhost` hardcodeado.
3. Distribuir el ZIP y cargarlo unpacked desde `apps/extension/dist` en cada entorno compartido
   (ver `docs/INTERNAL_EXTENSION_INSTALL.md`).
4. Validar el onboarding seguro contra el dominio real: `POST /api/v1/extension/link-token` →
   `POST /api/v1/extension/connect` → sesión vinculada (`apps/web/src/services/extensionTokens.ts`).
5. Ejecutar el flujo end-to-end en una reunión real desde un entorno no local y confirmar estado/badge.

## Decisiones

- **Dominio por configuración, no hardcode** — evita romper el límite duro de SSOT de env y permite cambiar de
  entorno sin recompilar a ciegas; se descarta dejar `localhost` "temporal".
- **Distribución por ZIP interno** — se mantiene la distribución interna actual; se descarta la Chrome Web Store
  por ahora (fuera de alcance).

## Riesgos

- **Hosts locales remanentes** — un `localhost` olvidado en `manifest`/código rompe el uso compartido;
  mitigación: grep explícito de `localhost`/`127.0.0.1` antes de cerrar.
- **Token flow en remoto** — el onboarding puede fallar por CORS/cookies/secret en el dominio real;
  mitigación: validar `link-token` + `connect` contra el dominio antes de probar la reunión completa.
- **`dist` desincronizado** — probar `src` sin regenerar `dist` da diagnósticos falsos; mitigación: siempre
  `bun run extension:build` y recargar unpacked antes de validar.
