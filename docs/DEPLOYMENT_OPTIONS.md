# Opciones de despliegue para Squaads Meeting Bot

## Resumen ejecutivo

La aplicación no es una única pieza. Está formada por una página web, una base de datos, un almacenamiento de vídeos y un **worker**, que es el componente encargado de entrar en las reuniones, grabarlas y procesarlas.

La web puede desplegarse en Vercel y seguir utilizando la base de datos y el almacenamiento actuales. Sin embargo, **el worker no puede trasladarse a Vercel en su forma actual**.

El worker concentra la parte más exigente de la aplicación: mantiene un navegador abierto durante toda la reunión, captura audio y vídeo, genera un archivo MP4 y ejecuta la transcripción y el resumen. Vercel está diseñado principalmente para atender peticiones de duración limitada, no para mantener este tipo de proceso multimedia activo durante reuniones largas.

Adaptar el worker a Vercel no sería un simple cambio de servidor. Obligaría a **rediseñar gran parte de su funcionamiento**, incluyendo la grabación, el control de procesos, los reintentos, el almacenamiento temporal y la recuperación ante fallos. El coste, el tiempo y el riesgo de esa reconstrucción no están justificados para una prueba de despliegue.

## Cómo está dividido el sistema

| Componente | Función | Destino adecuado |
|---|---|---|
| Web | Acceso de usuarios, panel, reuniones y resultados | Vercel |
| Base de datos | Usuarios, estados, transcripciones y resúmenes | Supabase/PostgreSQL actual |
| S3 | Almacenamiento privado de los vídeos MP4 | Servicio S3 actual |
| Worker | Entra en la reunión, graba, transcribe y resume | Servidor o plataforma con contenedores persistentes |

Separar estos componentes no es una limitación accidental. Es precisamente lo que permite usar Vercel para la web sin forzar el componente multimedia dentro de una plataforma que no encaja con sus necesidades.

## Por qué el worker no encaja en Vercel

El worker necesita permanecer activo durante toda la reunión y ejecutar simultáneamente un navegador, un sistema de audio virtual y FFmpeg. También necesita espacio temporal para generar el vídeo antes de enviarlo a S3.

Las Functions y los contenedores de Vercel siguen teniendo límites de duración, almacenamiento temporal y ciclo de vida. Aunque Vercel permita empaquetar una aplicación como contenedor, ese contenedor continúa funcionando como una Function limitada; no se convierte en un servidor permanente.

Existe una alternativa experimental denominada Vercel Sandbox, pero tampoco representa un traslado directo. Requeriría construir un nuevo sistema que iniciase y controlase un entorno independiente para cada reunión. Además, la documentación oficial no garantiza el comportamiento necesario para la captura de audio, el navegador y las grabaciones largas.

Por estas razones, **no recomendamos rehacer el worker para conseguir un despliegue íntegro en Vercel**.

## Cómo se han medido los riesgos

Los riesgos se han valorado en cinco áreas:

1. **Cantidad de reconstrucción:** cuánto código y arquitectura habría que modificar.
2. **Continuidad de las grabaciones:** probabilidad de interrumpir reuniones largas.
3. **Recuperación ante fallos:** posibilidad de perder o dejar bloqueada una grabación.
4. **Capacidad de prueba:** facilidad para que el equipo valide la aplicación completa.
5. **Coste y operación:** gasto mensual y responsabilidad de mantener la infraestructura.

| Alternativa | Reconstrucción | Riesgo de grabación | Pruebas del equipo | Coste inicial | Riesgo global |
|---|---|---|---|---|---|
| Rehacer el worker para Vercel | Muy alta | Alto, hasta completar el rediseño | Baja durante la reconstrucción | Imprevisible | **Muy alto** |
| Worker en VPS controlado por el equipo | Baja | Medio, requiere una prueba real | Alta | Bajo | **Medio** |
| Worker en plataforma gestionada | Baja | Medio, requiere una prueba real | Alta | Medio/alto | **Medio** |
| Worker local temporal | Nula | Bajo para desarrollo local | Limitada para el resto del equipo | Muy bajo | **Bajo, con alcance reducido** |

El riesgo principal no está en Vercel, Supabase o S3. Está en cambiar el entorno del worker sin demostrar antes que puede mantener una grabación completa, con audio y vídeo correctos, y recuperarse de una caída.

## Opciones propuestas

### Opción 1 — VPS de Hetzner controlado por el equipo

Contratar un VPS Linux donde el equipo tenga acceso directo y desplegar únicamente el contenedor del worker.

Hetzner ofrece servidores Linux con Docker, firewall y facturación por horas con un máximo mensual. Para una prueba puede estudiarse una instancia compartida de entrada, con un **presupuesto objetivo inferior a 9 EUR al mes**. El precio final debe confirmarse antes de contratar porque depende del modelo, ubicación, impuestos, copias de seguridad y recursos elegidos.

**Ventajas**

- Mantiene prácticamente intacto el worker actual.
- El equipo controla despliegues, registros, reinicios y configuración.
- Permite conectar el worker con Vercel, Supabase y S3.
- Coste bajo para una prueba completa y accesible para el equipo.

**Riesgos y responsabilidades**

- El equipo debe administrar Linux, Docker, seguridad, actualizaciones y monitorización.
- Un plan económico debe probarse con reuniones largas; el navegador y la grabación consumen memoria y CPU.
- Deben configurarse copias, alertas y un procedimiento de recuperación antes de considerarlo producción.

**Valoración:** opción recomendada para una primera prueba remota con coste controlado.

### Opción 2 — Plataforma gestionada para el worker

Desplegar el contenedor en una plataforma preparada para servicios persistentes, como Railway. La plataforma administra buena parte del servidor, los despliegues, HTTPS y los reinicios.

Railway Pro parte de 20 USD mensuales e incluye esa cantidad como crédito de uso. Un worker permanentemente activo con recursos suficientes puede superar ampliamente ese importe; la investigación estima aproximadamente 80 USD mensuales para 2 vCPU y 4 GB de RAM continuos, antes de transferencia adicional.

**Ventajas**

- Menos administración de servidores para el equipo.
- Despliegues, registros y rollback más sencillos.
- Railway permite configurar la memoria compartida requerida por el navegador.

**Riesgos y responsabilidades**

- Coste superior y variable según consumo.
- Todavía es obligatorio probar grabaciones largas, audio, estabilidad e IP del proveedor.
- La plataforma no elimina los riesgos propios del worker ni garantiza que las páginas de reuniones acepten siempre sus direcciones IP.

**Valoración:** buena opción gestionada después de demostrar el funcionamiento y aprobar el presupuesto.

### Opción 3 — Web, base de datos y S3 desplegados; worker local temporal

Desplegar la web en Vercel, mantener Supabase y S3, y ejecutar un único contenedor del worker en un ordenador local durante las pruebas.

La conexión sería la misma que en producción: la web crea la reunión en la base de datos, el worker local la recoge, genera el vídeo y lo sube al almacenamiento S3.

**Ventajas**

- Prácticamente sin coste adicional de infraestructura.
- Permite validar la integración completa antes de contratar otro servidor.
- No exige modificar la arquitectura ni rehacer el worker.

**Limitaciones**

- El worker solo funciona mientras el equipo local esté encendido y conectado.
- La aplicación no queda disponible de forma autónoma.
- El resto del equipo depende de la persona que mantiene el worker local.
- No representa una solución de producción ni permite una prueba operativa completa.

**Valoración:** útil como demostración inicial, pero se deja como última opción porque reduce la capacidad de prueba del equipo.

## Recomendación

La ruta más prudente es avanzar por etapas:

1. Desplegar la web en Vercel y mantener Supabase y S3 sin cambios.
2. Validar el worker con su contenedor actual, sin reconstruirlo.
3. Realizar una prueba remota en un VPS de Hetzner controlado por el equipo y con presupuesto limitado.
4. Medir reuniones cortas y de 90–120 minutos, consumo, calidad de audio/vídeo, reinicios y recuperación.
5. Si la prueba es estable y se prefiere reducir la administración, valorar posteriormente Railway u otra plataforma gestionada.

Esta ruta separa la demostración técnica de la inversión. También evita gastar tiempo en reconstruir el componente más importante de la aplicación para adaptarlo a una plataforma que no fue diseñada para ese trabajo.

## Criterios para aprobar un despliegue del worker

Antes de considerar que una alternativa está preparada, debe demostrar:

- Una grabación completa sin interrupciones.
- Audio y vídeo sincronizados.
- Subida correcta del MP4 a S3.
- Transcripción y resumen finalizados.
- Funcionamiento estable durante reuniones de 90–120 minutos.
- Recuperación documentada ante reinicio o caída.
- Acceso seguro desde la web y un único worker procesando la cola.
- Coste mensual medido y dentro del presupuesto aprobado.

## Fuentes oficiales consultadas

Investigación realizada y contrastada el 10 de julio de 2026:

- [Vercel Functions: límites](https://vercel.com/docs/functions/limitations)
- [Vercel: imágenes de contenedor](https://vercel.com/docs/functions/container-images)
- [Vercel Sandbox: precios y límites](https://vercel.com/docs/sandbox/pricing)
- [Vercel Hobby y uso comercial](https://vercel.com/docs/plans/hobby)
- [Hetzner Cloud](https://www.hetzner.com/cloud/)
- [Hetzner Cloud Regular Performance](https://www.hetzner.com/cloud/regular-performance/)
- [Railway: planes y precios](https://docs.railway.com/reference/pricing/plans)

Los precios son orientativos y deben confirmarse en la región y cuenta de contratación antes de tomar una decisión.
