# Squaads Meeting Bot — Glosario

Vocabulario canónico del dominio. Una entrada por término; definiciones cortas. No es un spec ni un
scratchpad: solo lenguaje.

## Asistente

**Squaads Assistant**:
El asistente de chat embebido en la web app (`apps/web/src/components/chat/`). Responde en español
(voseo) usando el corpus de conocimiento y herramientas del sistema.

**Corpus de conocimiento**:
El conjunto de documentos estáticos que alimenta el system prompt del asistente
(`apps/web/src/integrations/chat/knowledge/`). Es la única fuente de "entrenamiento" del chat; debe
reflejar el estado real de las features desplegadas.

**Soporte**:
Topic del Squaads Assistant que concentra la ayuda al usuario y aloja la entrada "Reportar un problema".
_Avoid_: support, ayuda

**Reportar un problema**:
Acción del usuario que envía un reporte al canal de Discord del equipo mediante el módulo `bug-report`.
En la UI vive dentro del topic Soporte del asistente y en el detalle de reunión. Registro de la copy: voseo.
_Avoid_: Report a bug, reportar un error, reportar un bug

## Compartir reuniones (post-009)

**Acceso**:
Permiso persistente de un usuario registrado sobre una reunión ajena (Access Grant en código). Se otorga
manualmente ("dar acceso") o automáticamente a co-asistentes del auto-join (ADR-0007). En copy de usuario
siempre "acceso", nunca "Access Grant".
_Avoid_: Access Grant (en UI), permiso, share

**Enlace de acceso restringido**:
Único tipo de share vigente (`restricted_email`): enlace enviado por email a un destinatario concreto.
Los enlaces públicos fueron eliminados en la feature 009 y no deben mencionarse como opción vigente.
_Avoid_: link público, share público, enlace público
