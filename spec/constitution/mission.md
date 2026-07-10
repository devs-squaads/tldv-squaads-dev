# Misión

> La razón de ser del proyecto. Es la referencia que decide si una feature "encaja" o no.

## Qué construimos

Un **bot self-hosted de reuniones** para Google Meet y Microsoft Teams que se une a la llamada, graba
audio/video, transcribe y genera un resumen estructurado con momentos clave y action items. Todo corre
en infraestructura propia, sin depender de un SaaS de terceros para el procesamiento.

Piezas principales del producto:

1. **Web (`apps/web`)** — dashboard y APIs ligeras: encola reuniones, muestra estado y resultados, gestiona
   usuarios, compartición y el chat asistente. No ejecuta captura ni IA pesada.
2. **Worker (`apps/worker`)** — el motor: Puppeteer + FFmpeg para grabar, y el pipeline de transcripción y
   resumen. Reclama reuniones `pending` y avanza sus estados.
3. **Extensión Chrome (`apps/extension`)** — cliente de presentación dentro de la reunión (invitar al bot,
   estado en vivo). Consume la misma API; nunca es el motor de grabación.
4. **Shared (`packages/shared`)** — dominio, esquema de DB, repositorios y contratos de integración
   reutilizados por web y worker.

## Para quién

- **Equipos que quieren control y privacidad self-hosted** de sus grabaciones y transcripciones, sin enviar
  sus reuniones a un proveedor externo.
- **Operadores técnicos** que despliegan y mantienen el bot (web en Vercel/servidor, worker en Docker privado).
- **Squaads** como autor y primer usuario del producto.

## Principios

- **API-first multicliente** — toda lógica de negocio vive en backend/servicios; web, extensión y futuros
  clientes consumen los mismos casos de uso vía API. La UI nunca duplica reglas de dominio.
- **Cero acoplamiento a proveedores** — cada integración (storage, transcripción, summary, calendar, sharing,
  email) se consume por contrato; añadir un proveedor no toca la lógica de negocio.
- **Separación estricta por rol** — `web`, `worker` y `shared` tienen fronteras claras que son parte del
  contrato de build/deploy.
- **Self-hosted y reproducible** — la grabación usa FFmpeg a nivel sistema (Xvfb/PulseAudio), no extensiones.

## Qué NO es

- **No es un SaaS multi-tenant** — es self-hosted, pensado para una organización que controla su infraestructura.
- **No graba con extensiones de navegador** — la captura es exclusivamente FFmpeg a nivel sistema; las
  extensiones solo son capa de presentación/cliente.
- **No mezcla roles** — `web` y `worker` nunca corren en la misma instancia de producción, ni acoplan DB/S3
  dentro de sus hosts.
- **No es una transcripción en tiempo real** — el flujo es grabar → procesar → resumir, no streaming en vivo.
