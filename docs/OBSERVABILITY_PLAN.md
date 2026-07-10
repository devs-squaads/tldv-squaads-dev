# Plan de Observabilidad y Soporte — V2

> **Fecha de actualización:** 2026-04-16
> **Estado:** Diseño ejecutable para implementación futura
> **Contexto:** Proyecto self-hosted, fase documental posterior al cierre validado del rediseño actual del chat

---

## 0. Propósito

Este documento define una **V2 realista, segura y ejecutable** para observabilidad + soporte en `tldv-squaads`.

Objetivos:

1. Mejorar trazabilidad de web/worker con logs estructurados y métricas útiles.
2. Habilitar escalación de soporte desde el chat **sin abrir agujeros de seguridad**.
3. Mantener una filosofía **self-hosted** y desacoplada por contratos.
4. Separar con claridad lo que se puede implementar **ahora** vs lo que queda para **más adelante**.

---

## 1. Restricciones obligatorias

### Reglas del repositorio que mandan

- Leer y respetar `AGENTS.md` (cerebro) y `spec/constitution/tech-stack.md` (la ley) antes de implementar nada.
- No romper funcionalidad existente por “mejorar observabilidad”. Primero fundamentos, después extras.
- No tocar Docker/Compose existentes sin avisar explícitamente al usuario.
- Si se agregan nuevas variables de entorno, hay que documentarlas junto con el cambio.
- Si esta V2 se aborda, se crea como feature SDD en `spec/features/NNN-…/` y su progreso se registra ahí
  y en `spec/constitution/roadmap.md` (la documentación operativa pre-SDD quedó congelada en `PROJECT_PROGRESS_LOG.md`).

### Restricción de esta V2

Esta V2 **no implementa nada por sí sola**. Define el orden correcto y el contrato para ejecutar el trabajo sin improvisar.

---

## 2. Decisiones rectoras

### 2.1 Filosofía self-hosted

La base recomendada sigue siendo self-hosted:

- **Logs:** stdout/stderr estructurado → Promtail → Loki → Grafana
- **Métricas:** Prometheus + exporters + endpoints propios
- **Alertas:** Alertmanager → relay compatible con Discord/webhook del equipo
- **Soporte chat:** provider interno desacoplado por contrato, sin acoplar el route handler a un vendor concreto

### 2.2 Principio clave: primero instrumentar, después alertar

NO se definen alertas sobre métricas imaginarias.

Si una métrica no está implementada y documentada en esta V2, **no se usa** para alertas. Punto.

### 2.3 Principio clave: el cliente NO es fuente de verdad para soporte

`/api/support` no puede confiar ciegamente en `chatHistory` enviado por el navegador.

El servidor debe:

- validar payload,
- limitar tamaño,
- sanitizar contenido,
- redactar PII sensible antes de reenviar,
- y reconstruir/derivar contexto server-side cuando aplique.

---

## 3. Qué se implementa ahora vs futuro

## Ahora / próximo trabajo recomendado

1. **Track 1A — Logger estructurado**
2. **Track 1B — Support seguro desde chat**
3. **Track 2 — Stack self-hosted de observabilidad**
4. **Track 3 — Métricas de aplicación realmente instrumentadas**
5. **Track 4 — Dashboards, alertas y runbooks**

## Futuro / diferido

- tracing distribuido
- alertas avanzadas por SLO
- retención multi-tier de logs
- correlación automática de incidents/tickets
- redacción avanzada basada en clasificación semántica

---

## 4. Arquitectura objetivo V2

```text
meeting-web stdout/stderr  ──┐
meeting-worker stdout/stderr ├──▶ Promtail ─▶ Loki ─▶ Grafana
postgres / infra logs      ──┘

node-exporter ───────────────┐
cadvisor ────────────────────┼──▶ Prometheus ─▶ Alertmanager ─▶ Discord/webhook del equipo
postgres-exporter ───────────┤
web /api/metrics ────────────┤
worker /metrics ─────────────┘

Usuario chat ─▶ POST /api/support ─▶ SupportNotificationProvider ─▶ canal interno de soporte
```

---

## 5. Orden recomendado de ejecución

## Track 1A — Logger estructurado

### Objetivo

Pasar de `console.log` suelto a logs estructurados con contexto estable para web y worker.

### Por qué va primero

Sin logs estructurados, Loki sirve solo a medias. Y peor: después nadie sabe qué pasó en producción.

### Alcance recomendado

- `packages/shared/src/logger.ts`
- implementación JSON lines para producción
- implementación legible para desarrollo
- migración progresiva de logs críticos en worker y web

### Contrato mínimo del log

Campos esperados por línea:

- `ts`
- `level`
- `service`
- `msg`
- `meetingId` (cuando aplique)
- `userId` (cuando aplique)
- `provider` (cuando aplique)
- `requestId` o correlativo equivalente cuando exista

### Regla de oro

Al migrar logs NO se cambia lógica de negocio. Solo se reemplaza emisión de logs.

---

## Track 1B — Soporte seguro desde el chat

### Objetivo

Permitir escalación a soporte desde la UX del chat sin exponer datos sensibles ni confiar en payloads manipulables del cliente.

### Contrato recomendado

`POST /api/support`

### Requisitos de seguridad obligatorios

1. **Sesión autenticada obligatoria**
2. **Rate limit** por usuario/sesión/IP
3. **Payload máximo** explícito
4. **Sanitización** de strings de entrada
5. **Redacción de PII** antes de persistir o reenviar
6. **No confiar ciegamente en `chatHistory` del cliente**
7. **Reconstrucción server-side del contexto cuando aplique**

### Qué significa “no confiar en `chatHistory`”

El cliente puede mentir, omitir, duplicar o inflar mensajes. Entonces:

- `userMessage` puede aceptarse como intención inmediata, pero validado y truncado.
- `chatHistory` del cliente solo puede usarse como **hint**, nunca como verdad final.
- Si existe historial persistido del chat o contexto recuperable desde backend, el servidor debe usar eso como prioridad.
- Si no existe reconstrucción completa, el servidor debe enviar un resumen minimizado y marcado como “contexto parcial reportado por cliente”.

### Payload propuesto V2

```json
{
  "userMessage": "texto validado",
  "chatHistory": [{ "role": "user", "content": "..." }]
}
```

### Reglas de validación mínimas

- `userMessage`: requerido, string, trim, largo máximo definido
- `chatHistory`: opcional, largo máximo de items, largo máximo por mensaje, roles permitidos cerrados
- rechazo de payloads gigantes
- rechazo de contenido binario/estructuras inesperadas

### Redacción de PII

Antes de mandar el ticket al provider de soporte:

- ocultar emails cuando no sean indispensables
- ocultar tokens, secretos, cookies, authorization headers
- truncar URLs sensibles
- evitar reenviar transcripciones completas si no son necesarias para resolver el incidente

### Provider design

Mantener contrato desacoplado:

- `SupportNotificationProvider`
- `DiscordSupportProvider` u otro provider concreto
- `SupportNotificationFactory`

El route handler NO habla directo con Discord.

### Métrica de soporte asociada

Solo una métrica base en V2 inicial:

- `support_tickets_total{result="accepted|rejected|failed"}`

Nada más hasta tener el flujo realmente instrumentado.

---

## Track 2 — Stack self-hosted de observabilidad

### Objetivo

Levantar el stack separado sin contaminar los compose actuales del producto.

### Regla operativa

Usar archivo compose separado, por ejemplo:

- `observability/docker-compose.observability.yml`

NO mezclar esta infraestructura dentro del compose principal sin decisión explícita posterior.

### Componentes recomendados

- Grafana
- Prometheus
- Alertmanager
- Loki
- Promtail
- node-exporter
- cadvisor
- postgres-exporter

### Advertencia FUERTE: Promtail + Docker socket

Promtail leyendo metadatos/logs de Docker puede requerir acceso a:

- `/var/run/docker.sock`
- rutas de logs de contenedores del host

Eso es **privilegiado**. No es un detalle menor. En muchos entornos equivale casi a acceso de alto poder sobre el host.

Entonces la V2 exige documentar una de estas decisiones ANTES de implementar:

1. **Entorno dev/lab solamente** con aceptación explícita del riesgo
2. **Host dedicado de observabilidad** con controles adicionales
3. **Alternativa sin socket Docker** si el entorno productivo no tolera ese nivel de privilegio

Si no hay aprobación explícita del usuario/equipo para ese riesgo, Track 2 NO se ejecuta.

---

## Track 3 — Métricas de aplicación

### Objetivo

Instrumentar pocas métricas, pero reales y mantenibles.

### Regla

Las alertas del Track 4 solo pueden usar métricas listadas acá y efectivamente implementadas.

### Worker — métricas base V2

- `meetings_processed_total{status="completed|error|rejected"}`
- `meeting_processing_duration_seconds`
- `transcription_duration_seconds{provider="..."}`
- `transcription_errors_total{provider="..."}`
- `active_recordings_gauge`

### Web — métricas base V2

- `http_requests_total{route="...",status="..."}`
- `chat_requests_total{result="ok|error"}`
- `support_tickets_total{result="accepted|rejected|failed"}`
- `auth_failures_total{surface="..."}`

### Protección de `/api/metrics`

Acá había un hueco serio. V2 lo cierra así:

#### Contrato permitido

`/api/metrics` debe exponerse solo por UNA de estas vías explícitas:

1. **API key dedicada** para scraping interno, o
2. **red interna/capa privada** donde el endpoint no quede expuesto públicamente

### Regla V2

Si no existe una de esas dos protecciones, `/api/metrics` NO se publica.

### Requisitos mínimos

- denegar acceso por defecto
- no usar auth de usuario final para scraping técnico
- documentar claramente cómo scrapea Prometheus
- registrar intentos fallidos de acceso si aplica

### Nota importante

El worker puede exponer `/metrics` interno en red privada si el despliegue lo permite, pero web y worker deben tener contrato de acceso cerrado, no “a ver si después lo protegemos”. ESO ES CÓMO SE ROMPEN LOS SISTEMAS.

---

## Track 4 — Dashboards, alertas y runbooks

### Objetivo

Dar visibilidad operativa útil y alertas accionables, no ruido.

### Dashboards mínimos V2

1. **Overview del sistema**
   - estado de targets Prometheus
   - errores por servicio
   - throughput básico

2. **Worker processing**
   - reuniones procesadas
   - duración total
   - errores de transcripción
   - grabaciones activas

3. **Chat/support**
   - requests de chat
   - tickets de soporte
   - auth failures

### Alertas permitidas en V2

Solo sobre métricas definidas arriba.

#### Ejemplos válidos

- `WorkerContainerDown`
  - basado en `up{job="meeting-worker"} == 0`

- `WorkerTranscriptionErrorRateHigh`
  - basado en `transcription_errors_total` vs `meetings_processed_total`

- `SupportTicketFailures`
  - basado en `support_tickets_total{result="failed"}`

- `WebAuthFailuresSpike`
  - basado en `auth_failures_total`

#### Ejemplo explícitamente NO válido en V2

- alerta basada en `meetings_in_queue`

Motivo: esa métrica no está definida en esta V2. Entonces NO se usa.

### Runbooks mínimos

Cada alerta crítica debe tener runbook corto con:

- qué significa
- cómo verificar rápido
- primera acción segura
- escalación siguiente

---

## 6. Secuencia concreta de implementación

### Fase 1A — Logger estructurado

- crear logger shared
- exportarlo correctamente
- migrar logs críticos sin tocar negocio
- documentar `LOG_LEVEL`

### Fase 1B — `/api/support` seguro

- definir contrato provider
- crear route handler con auth + rate limit + payload limit
- sanitizar/redactar contenido
- reconstruir contexto server-side cuando sea posible
- instrumentar `support_tickets_total`

### Fase 2 — Stack observability separado

- crear `observability/`
- compose separado
- provisioning base de Grafana/Prometheus/Loki
- confirmar explícitamente riesgo operacional de Promtail

### Fase 3 — Métricas

- instrumentar worker
- instrumentar web
- proteger `/api/metrics`
- documentar contrato de scrape

### Fase 4 — Dashboards + alertas + runbooks

- dashboards base
- alertas solo sobre métricas existentes
- runbooks cortos por alerta

---

## 7. Variables de entorno que probablemente aparecerán

Según lo que efectivamente se implemente, documentar en README + env examples:

- `LOG_LEVEL`
- `DISCORD_SUPPORT_WEBHOOK_URL` o equivalente del provider elegido
- `SUPPORT_RATE_LIMIT_*` si se parametriza
- `METRICS_API_KEY` si se elige protección por API key
- variables del stack de observabilidad si se agregan en compose separado

No inventarlas en código sin documentarlas en el mismo bloque de trabajo.

---

## 8. Fuera de alcance de esta V2

Para evitar deriva y humo documental, esta V2 NO asume:

- archivos inexistentes o dudosos como `CHAT_BOT_CONTRACT.md`
- métricas no instrumentadas
- alertas sobre colas invisibles
- exposición pública de `/api/metrics`
- trust ciego en historial del cliente para soporte

---

## 9. Checklist de aceptación de la V2

La implementación futura de esta V2 debería considerarse sana solo si cumple todo esto:

- [ ] logs estructurados realmente emitidos por web/worker
- [ ] `/api/support` con auth, rate limit, payload limit, sanitización y redacción
- [ ] el servidor no depende ciegamente de `chatHistory` del cliente
- [ ] `/api/metrics` protegido por API key o red interna cerrada
- [ ] stack observability en compose separado
- [ ] riesgo de Promtail + Docker socket documentado y aceptado explícitamente
- [ ] alertas definidas solo sobre métricas existentes
- [ ] dashboards y runbooks base documentados

---

## 10. Resumen ejecutivo

La V1 tenía buena intención, pero mezclaba ideas útiles con huecos peligrosos. La V2 corrige eso.

Primero fundamentos, después infraestructura, después alertas. No al revés.

Orden recomendado final:

1. **1A — logger estructurado**
2. **1B — support seguro desde chat**
3. **2 — stack self-hosted de observabilidad**
4. **3 — métricas de aplicación protegidas**
5. **4 — dashboards, alertas y runbooks**

Es así. Sin humo, sin métricas inventadas y sin abrir endpoints o privilegios peligrosos “para después ver”.
