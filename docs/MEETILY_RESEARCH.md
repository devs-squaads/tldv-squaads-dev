# Meetily no elimina el worker de Squaads: investigación comparativa

## Veredicto ejecutivo

**Meetily no desbloquea el alojamiento actual de Squaads, no elimina la necesidad de un worker persistente y no hace viable una arquitectura íntegramente en Vercel.** La edición Community inspeccionada es una aplicación de escritorio Tauri que graba el micrófono y el audio reproducido por el equipo del usuario. No abre Chromium, no entra autónomamente en Google Meet, Microsoft Teams o Zoom, no captura vídeo de la reunión y no opera como servicio remoto multiusuario.

El valor real de Meetily está en componentes y lecciones acotados:

- **REUSE:** utilidades puras de segmentación de texto, limpieza de respuestas LLM y plantillas, después de aislarlas y conservar los avisos MIT.
- **ADAPT:** checkpoints de audio, recuperación por concatenación, abstracción de transcripción y ciclo de descarga de modelos. Son patrones útiles, pero su implementación Rust/Tauri/local requiere una reescritura sustancial para Bun/Linux/S3.
- **LEARN:** persistencia incremental, cancelación, estados explícitos de modelos, límites de búfer, telemetría opt-in y separación entre proveedor y orquestación.
- **REJECT:** sustituir el bot/browser de Squaads por la captura de dispositivo de Meetily; reutilizar el backend Docker legado; portar la aplicación Tauri al worker; asumir que “self-hosted” significa servidor Community.

La acción que puede desbloquear el progreso ahora sigue siendo **probar el contenedor actual de Squaads en un VPS Linux controlado por el equipo**, sin incorporar Meetily. El POC propuesto se detalla más adelante.

## Diferencia crítica de producto y arquitectura

| Dimensión | Squaads | Meetily Community v0.4.0 | Consecuencia |
|---|---|---|---|
| Modelo | Bot alojado en servidor | Aplicación de escritorio local | No son sustitutos operativos |
| Entrada a reuniones | Chromium/Puppeteer entra como participante | El usuario ya está en la reunión desde su equipo | Meetily no resuelve admisión, cookies ni IP del proveedor |
| Captura | Xvfb + PulseAudio + FFmpeg; audio y vídeo | Micrófono + audio del dispositivo; solo audio | No reemplaza la grabación MP4 audiovisual de Squaads |
| Ciclo de vida | Proceso Bun/Linux persistente que sondea PostgreSQL | Proceso Tauri iniciado por el usuario | No elimina el worker ni su necesidad de ejecución prolongada |
| Persistencia | PostgreSQL/Supabase + S3 privado | SQLite y archivos locales por usuario | La frontera de datos es incompatible |
| Clientes | Web y extensión desacopladas del worker | UI Next.js exportada dentro del WebView | Su frontend no es un servicio web equivalente |
| Concurrencia | Cola remota; hoy una grabación segura | Una sesión de escritorio por aplicación | No aporta coordinación distribuida |

La documentación oficial de Tauri confirma que este framework empaqueta una UI web en el WebView del sistema y la comunica por mensajes con un núcleo Rust de **aplicación de escritorio**. En Meetily, `frontend/next.config.js` establece `output: 'export'`; la documentación de Next.js confirma que este modo produce contenido estático y no ofrece funciones que requieran un servidor Node. El procesamiento real reside en Rust, SQLite y binarios sidecar locales, no en Vercel.

## Alcance reproducible de la evidencia

| Campo | Valor inspeccionado |
|---|---|
| Repositorio | <https://github.com/Zackriya-Solutions/meetily> |
| URL de clonación | `https://github.com/Zackriya-Solutions/meetily.git` |
| Commit exacto | `0281737d87d26352fb0adc78c8c0975f691b23d1` |
| Fecha del commit | `2026-06-05T19:22:04+05:30` |
| Asunto | `Merge pull request #502 ... release/v0.4.0` |
| Tag en el commit | `v0.4.0` |
| Release | `Meetily v0.4.0`, publicada el 5 de junio de 2026 |
| Fecha de consulta | 10 de julio de 2026 |
| Método | Inspección estática; no se instalaron dependencias ni se ejecutaron aplicaciones, modelos, builds o tests |

El tag `v0.4.0` apunta al commit inspeccionado. La release pública contiene instaladores firmados para Windows, DMG/App tarball para Apple Silicon y manifiesto del actualizador; no contiene una imagen de servidor Community ni un artefacto Linux de producción.

### CodeGraph

El clon no tenía un índice utilizable. `codegraph explore` informó inicialmente que no existía un índice; se ejecutó una única inicialización, que indexó 354 archivos, 5.813 nodos y 14.481 relaciones. Después, CodeGraph **sí funcionó** y se utilizó antes de la inspección amplia del filesystem. Sus mapas se contrastaron con lectura directa porque el primer trazado de la ruta de grabación fue incompleto.

## Arquitectura real de Meetily

### Mapa de componentes

```text
Usuario en su equipo
  └─ UI Next.js 14 exportada como estática
       └─ invoke/eventos de Tauri
            ├─ Rust/Tauri
            │   ├─ captura CPAL / WASAPI / ALSA / Core Audio
            │   ├─ mezcla + remuestreo + VAD
            │   ├─ Whisper o Parakeet local
            │   ├─ SQLite + archivos de reunión
            │   └─ proveedores de resumen
            ├─ sidecar ffmpeg
            └─ sidecar llama-helper + modelos GGUF
```

Archivos de entrada y composición:

- `frontend/src-tauri/src/lib.rs` — registra estado, plugins y comandos Tauri.
- `frontend/src/services/recordingService.ts` — puente UI hacia `start_recording*` y `stop_recording`.
- `frontend/src-tauri/src/audio/recording_commands.rs` — ciclo de inicio/parada, eventos y coordinación.
- `frontend/src-tauri/src/audio/recording_manager.rs` — compone streams, pipeline, saver y monitor de dispositivos.
- `frontend/src-tauri/tauri.conf.json` — empaqueta UI, `llama-helper` y `ffmpeg` como binarios externos.

### Flujo real de grabación

1. La UI invoca `start_recording_with_devices_and_meeting` desde `frontend/src/services/recordingService.ts`.
2. `audio/recording_commands.rs` valida que Whisper o Parakeet esté cargado, resuelve micrófono/salida y crea un `RecordingManager` global de proceso.
3. `audio/recording_manager.rs` abre dos canales sin límite: uno hacia transcripción y otro hacia persistencia incremental. Inicia el pipeline antes de los streams.
4. `audio/stream.rs` abre el micrófono con CPAL. Para audio de sistema usa Core Audio directo en macOS cuando está seleccionado; en los demás casos usa la ruta CPAL y configuración específica de plataforma.
5. `audio/pipeline.rs` convierte a mono, remuestrea a 48 kHz, aplica filtro/normalización al micrófono, acumula ambas fuentes, rellena ausencias con silencio y mezcla ventanas.
6. La mezcla completa se envía en paralelo a:
   - VAD, que la reduce a segmentos de voz de 16 kHz para transcripción;
   - `RecordingSaver`, que genera checkpoints locales.
7. `audio/transcription/worker.rs` procesa serialmente los segmentos para conservar el orden y emite `transcript-update` con tiempos relativos.
8. `audio/recording_saver.rs` escribe `transcripts.json` de forma atómica y delega audio en `audio/incremental_saver.rs`.
9. Cada 30 segundos, el saver codifica un `audio_chunk_NNN.mp4`; al parar, FFmpeg concatena los fragmentos sin recodificar en `audio.mp4` y elimina checkpoints.
10. La parada fuerza vaciado, espera hasta 10 minutos por transcripción, descarga el modelo, finaliza archivos y deja a la UI la escritura final en SQLite.

### Captura exacta por sistema operativo

#### Windows

- `audio/devices/platform/windows.rs` enumera entradas y salidas WASAPI y marca salidas para loopback.
- La salida se obtiene mediante la bifurcación de CPAL fijada en `Cargo.toml`; `audio/stream.rs` construye un `build_input_stream` sobre el dispositivo configurado.
- La implementación depende del comportamiento del fork de CPAL y de WASAPI; no es una captura de navegador ni una sesión virtual de servidor.
- La ruta degrada la falta de audio de sistema a grabación solo de micrófono y clasifica errores de desconexión/permisos.

#### macOS

- `audio/capture/core_audio.rs` usa un tap global mono de Core Audio, un dispositivo agregado privado y un ring buffer de 128 Ki muestras.
- El código documenta una corrección concreta: usa solo el tap y no duplica la salida como subdispositivo, evitando eco.
- Tras más de diez desbordamientos consecutivos marca terminación; `audio/stream.rs` consume muestras en bloques de 1.024.
- Micrófono y audio de sistema requieren permisos locales del sistema operativo.

#### Linux

- `audio/devices/platform/linux.rs` busca entradas ALSA cuyo nombre contenga `monitor` y las trata como fuentes PulseAudio de sistema.
- `audio/devices/configuration.rs` vuelve a abrir esa fuente como entrada CPAL.
- Hay una inconsistencia de nombres: el descubrimiento añade `" (System Audio)"`, mientras la resolución compara el nombre decorado con el nombre real. Esto, junto con los issues abiertos de PipeWire/ALSA, impide considerar la ruta Linux madura o portable al contenedor Squaads.

#### Mezcla, buffering y fallos

- La ruta activa está en `audio/pipeline.rs`, no en `audio_v2/`: esta última aún contiene `TODO` para transcripción y guardado.
- El pipeline activo declara una ventana de `600 ms`, aunque comentarios cercanos hablan de `50 ms`; su límite real es ocho ventanas. Si se supera, descarta muestras antiguas y registra advertencias.
- Los canales de captura, transcripción y guardado son `unbounded_channel`; por tanto, “zero chunk loss” es una intención de diseño, no una garantía bajo presión de memoria o bloqueo prolongado.
- El mezclador suma micrófono y sistema y escala picos por muestra; no preserva pistas separadas ni identidad de hablante.
- `audio/ffmpeg_mixer.rs` contiene una alternativa con buffers por fuente y ducking, pero la ruta activa de `AudioPipeline` no instancia `FFmpegAudioMixer`. Debe estudiarse como código no conectado, no como comportamiento de producción.

## Transcripción, modelos y diarización

### Motores activos

`audio/transcription/provider.rs` define un contrato pequeño (`transcribe`, estado del modelo y nombre del proveedor), pero `audio/transcription/engine.rs` conserva variantes directas de Whisper y Parakeet por compatibilidad. La abstracción es parcial.

- **Whisper:** `whisper_engine/whisper_engine.rs`, basado en `whisper-rs`/whisper.cpp; catálogo y descargas desde Hugging Face.
- **Parakeet:** `parakeet_engine/`, ONNX Runtime `ort`, modelo Parakeet TDT 0.6B v3 convertido a ONNX.
- **Entrada común:** mono `f32` a 16 kHz; VAD previo en `audio/pipeline.rs`.
- **Paralelismo real:** un único worker en `audio/transcription/worker.rs`, deliberadamente serial para mantener el orden.

Meetily soporta CPU en las compilaciones por defecto de Windows/Linux y aceleraciones opcionales de build (Vulkan/CUDA/OpenBLAS); macOS activa Metal/CoreML en el manifiesto. Esto no equivale a una garantía de GPU en todas las releases. Issues recientes muestran incompatibilidades de CPU, Vulkan y builds Linux. Para Squaads, incorporar ONNX/Whisper local aumentaría imagen, memoria, tiempo de arranque y superficie operativa; no desbloquea el hosting.

### Descarga y ciclo de modelos

- Whisper, Parakeet y los modelos de resumen se descargan bajo demanda al directorio local de la aplicación.
- `summary/summary_engine/model_manager.rs` permite reanudar por HTTP Range, cancelar, informar velocidad/porcentaje y detectar tamaño fuera de un margen del 10 %.
- La validación observada es principalmente por tamaño; no hay hash criptográfico o firma por modelo en esa ruta. Es un riesgo de cadena de suministro visible, no una vulnerabilidad demostrada.
- Los modelos de resumen Qwen/Gemma se descargan desde URLs externas y se ejecutan con `llama-helper`; sus licencias son independientes del MIT del repositorio.

### Diarización

La Community inspeccionada **no ofrece diarización integrada en la ruta compilada y activa**:

- `audio/stt.rs` contiene código antiguo de embeddings/Pyannote y un campo `speaker_embedding`, pero no está declarado por el módulo `audio/mod.rs` ni conectado al pipeline actual.
- La UI no presenta etiquetas de hablante.
- El README coloca identificación de hablantes y diarización en Pro/“coming soon”.
- Al 10 de julio de 2026 había PRs abiertos para renombrado e identificación de hablantes; un PR abierto no prueba una capacidad incluida en v0.4.0.

## Resúmenes, almacenamiento y privacidad

### Proveedores de resumen

`summary/llm_client.rs` centraliza OpenAI, Claude, Groq, OpenRouter, Ollama, un endpoint OpenAI-compatible y un modelo local Built-in AI. `summary/processor.rs` implementa:

- mensajes comunes y variantes Claude;
- timeout y cancelación;
- chunking jerárquico para contexto local limitado;
- plantillas Markdown y defensa explícita frente a instrucciones dentro del transcript;
- limpieza de bloques `<think>` y fences;
- generación canónica en inglés y traducción posterior.

El patrón **mapea conceptualmente** a los contratos de proveedor de Squaads, pero no debe copiarse completo: usa un `enum` central con `match`, exactamente el tipo de variación por proveedor que las convenciones de Squaads evitan. Las utilidades puras sí son candidatas; el dispatcher debe reescribirse detrás de interfaces/factories de Squaads.

### Persistencia

- SQLite local mediante SQLx almacena reuniones, transcripts, configuración y procesos de resumen.
- Cada reunión también tiene `metadata.json`, `transcripts.json`, checkpoints y `audio.mp4` en disco local.
- No hay cola distribuida, lease, reaper de claims, tenencia remota, S3 o control de concurrencia entre instancias.
- Las claves API se guardan como texto en columnas SQLite (`database/repositories/setting.rs`), no en un keychain; la política afirma cifrado apoyado en el dispositivo, no cifrado propio de esos campos.

### Fronteras de privacidad y seguridad

- El modo local puede mantener audio y transcripción en el dispositivo.
- Si el usuario selecciona OpenAI, Claude, Groq, OpenRouter, Ollama remoto o endpoint personalizado, el transcript/prompts salen hacia ese proveedor. Por tanto, “no data ever leaves your computer” solo es cierto para una configuración exclusivamente local.
- PostHog existe y se inicializa únicamente cuando la UI invoca `init_analytics`; la configuración por defecto del cliente es desactivada. La sanitización elimina nombres y rutas conocidos, aunque conserva un `meeting_id` generado. No se ejecutó la app para validar UX de consentimiento.
- La CSP permite solo orígenes locales muy concretos, pero las capacidades Tauri conceden lectura/escritura amplia (`fs:read-all`, `fs:write-all`). Es una superficie de privilegio relevante para desktop, no evidencia de una explotación.
- Los endpoints OpenAI-compatible aceptan `http://`; útil para LAN local, pero requiere controles adicionales si se emplea fuera de un entorno confiable.

## Impacto sobre el bloqueo de despliegue

### 1. ¿Elimina Meetily el worker persistente o hace viable “todo en Vercel”?

**No.** Traslada el cómputo a un proceso desktop persistente controlado por cada usuario; no lo convierte en una Function. Su núcleo Rust mantiene streams de audio, modelos, tareas, SQLite y sidecars durante toda la reunión. Vercel podría servir archivos estáticos similares a su UI, pero no sustituir el proceso Tauri, el acceso a dispositivos locales ni los sidecars. Squaads seguiría necesitando un worker persistente para el bot remoto.

### 2. ¿Puede reemplazar la grabación de Squaads?

**No para el producto actual.** Meetily captura el micrófono y la salida de audio del ordenador donde corre. Squaads necesita que un bot autónomo entre a una URL y capture navegador, audio y vídeo en un host remoto. Adoptar Meetily significaría rediseñar el producto como cliente instalado y dependiente del usuario, perder automatización y vídeo, cambiar consentimiento/admisión y abandonar la arquitectura web/worker existente.

### 3. ¿Qué sí puede aportar?

Puede aportar patrones de durabilidad local, segmentación, recuperación y gestión de modelos. Ninguno elimina los problemas conocidos de Squaads: lease/reaper, MP4 completo antes de S3, observabilidad/rollback, admisión/IP o falta de un entorno remoto controlado.

## Matriz REUSE / ADAPT / LEARN / REJECT

| Clasificación | Candidato y referencias | Valor | Coste / blast radius |
|---|---|---|---|
| **REUSE** | `summary/processor.rs`: `chunk_text`, `rough_token_count`, `clean_llm_markdown_output` | Utilidades puras y testeables para transcripts largos y limpieza | **Bajo–medio.** Portar a TypeScript, tests TDD y revisar prompts; afecta solo resumen |
| **REUSE** | `summary/templates/{types,loader,defaults}.rs` | Esquema de plantillas y separación estructura/instrucciones | **Medio.** Adaptar al contrato actual; DB/UI si se expone al usuario |
| **ADAPT** | `audio/incremental_saver.rs`, `audio/recording_saver.rs` | Checkpoint cada 30 s, manifest, escritura atómica y recuperación | **Alto.** Squaads captura A/V, usa FFmpeg continuo y S3; requiere fragmentación compatible, subida multipart y pruebas largas |
| **ADAPT** | `audio/transcription/provider.rs` | Contrato mínimo proveedor/resultado/estado | **Medio.** Reescribir en TS y alinear con contratos existentes; no copiar compatibilidad dual del enum |
| **ADAPT** | `summary/llm_client.rs` | Parámetros comunes, timeout, cancelación, endpoint compatible | **Medio.** Extraer políticas sin introducir `switch` central; toca providers y tests |
| **ADAPT** | `summary/processor.rs`, `summary/service.rs` | Resumen jerárquico, cancelación y caché por fingerprint de entradas | **Medio–alto.** Integración con DB, políticas actuales y control de prompt injection |
| **ADAPT** | `summary/summary_engine/model_manager.rs`; `whisper_engine/`; `parakeet_engine/` | Estados de descarga, reanudación, cancelación y modelos locales | **Alto.** Añade Rust/ONNX/GGUF/GPU o exige reimplementación; no es prioritario para hosting |
| **LEARN** | `audio/incremental_saver.rs` | No esperar al final para materializar todo el archivo | **Bajo para backlog**, alto para implementación correcta A/V + S3 |
| **LEARN** | `audio/pipeline.rs`, `audio/transcription/worker.rs` | Límites explícitos, timestamps relativos y cierre ordenado | **Medio.** Aplicar métricas/colas limitadas, no copiar canales ilimitados |
| **LEARN** | `audio/device_monitor.rs`, `recording_state.rs` | Estados de desconexión/reconexión y errores tipados | **Medio.** Inspiración para heartbeat/lease y observabilidad del worker |
| **LEARN** | `summary/summary_engine/model_manager.rs` | UX de estado/cancelación/reintento | **Bajo–medio.** Útil si Squaads incorpora modelos autogestionados |
| **LEARN** | UI de historial, detalle y progreso bajo `frontend/src/` | Comunicación clara de grabación/transcripción/resumen | **Medio.** Solo capa web; validar accesibilidad y patrones actuales |
| **REJECT** | `audio/capture/*`, `audio/devices/platform/*` como reemplazo | Captura de dispositivo local | **Muy alto/incompatible.** No entra en reuniones ni captura vídeo |
| **REJECT** | `audio_v2/*` | Refactor experimental | Tiene `TODO` para transcripción/guardado; no es ruta productiva |
| **REJECT** | `backend/*`, Dockerfiles y `docker-compose.yml` | Aparente servidor/Docker | El propio `backend/README.md` lo declara archivo legado, no soportado e inseguro para producción |
| **REJECT** | Aplicación Tauri completa | Producto desktop autocontenido | Reescritura total de roles, persistencia, despliegue y UX |
| **REJECT** | Código antiguo `audio/stt.rs` de Pyannote | Aparente diarización | No está conectado ni compilado en la ruta actual; procedencia/licencias adicionales sin cerrar |

### Blast radius de los candidatos prometedores

1. **Utilidades de resumen:** acotables al worker de IA y sus tests. No afectan captura, DB queue ni S3 si se mantienen detrás del contrato existente.
2. **Checkpoints/fragmentos:** afectan FFmpeg, formato final, sincronía A/V, recovery, S3, cleanup y observabilidad. Es el candidato con mayor valor futuro y mayor riesgo de regresión.
3. **Abstracción de transcripción:** toca factory, configuración, env, errores y pruebas de providers; viable solo si extiende contratos actuales sin bifurcaciones de negocio.
4. **Modelos locales:** afecta Dockerfiles, tamaño de imagen/volumen, CPU/GPU, tiempos de despliegue, licencias y operación. Debe permanecer fuera del camino crítico de despliegue.

## Licencia y cautelas legales

> Esta sección registra hechos técnicos y documentales; no sustituye asesoramiento jurídico.

### Hechos comprobados

- El repositorio raíz declara licencia **MIT** en `LICENSE.md`; exige conservar copyright y texto de permiso en copias o porciones sustanciales.
- `frontend/src-tauri/Cargo.toml` también declara MIT.
- El submódulo `backend/whisper.cpp` está fijado a `d682e150908e10caa4c15883c633d7902d385237`; el fork informa MIT y el upstream whisper.cpp publica MIT.
- El README reconoce código tomado de whisper.cpp, Screenpipe y transcribe-rs, pero no identifica archivos, commits ni avisos por fragmento.
- Parakeet TDT 0.6B v3 y la conversión ONNX usada declaran **CC BY 4.0**: su distribución/uso exige atribución según esa licencia, separada del MIT del código.
- El modelo Qwen 3.5 usado por el registro declara Apache-2.0 en su model card. Los modelos Gemma requieren aceptar términos de Google/Hugging Face; no debe suponerse que MIT cubre sus pesos.
- Las dependencias Rust/JavaScript conservan sus licencias propias. El MIT del proyecto no las relicencia.

### Qué puede reutilizarse legalmente con menor incertidumbre

Los archivos originales de Meetily bajo la licencia raíz —por ejemplo, utilidades de `summary/processor.rs` o el contrato de `audio/transcription/provider.rs`— son candidatos plausibles, siempre que se:

1. conserve el aviso MIT de Zackriya Solutions;
2. documente la procedencia y commit exacto;
3. compruebe que el fragmento no procede de uno de los proyectos “borrowed” o de un contributor con condiciones adicionales;
4. mantengan avisos de terceros y atribuciones de modelos cuando corresponda.

### Puntos que requieren revisión jurídica antes de copiar

- Mapeo de procedencia de código atribuido genéricamente a Screenpipe/transcribe-rs.
- Redistribución de modelos y pesos, especialmente Gemma y Parakeet CC BY 4.0.
- Distribución de FFmpeg según la configuración concreta y codecs incluidos.
- Uso comercial y obligaciones de marcas/atribución en un producto derivado.
- Compatibilidad del destino Squaads y sus dependencias con todos los avisos acumulados.

Hasta resolver esos puntos, la ruta más segura es **reimplementar los patrones pequeños** a partir de una especificación propia y usar el código como referencia, no copiar subsistemas completos.

## Madurez y señales del proyecto

- Actividad reciente: v0.4.0 fue publicada el 5 de junio de 2026 y había issues/PRs activos el 10 de julio.
- Historial de releases: varias pre-releases desde febrero de 2025 y cuatro releases principales hasta v0.4.0.
- Señal positiva: pipelines de build separados para macOS, Windows y Linux; empaquetado Tauri y actualizador firmado.
- Límite: la release oficial v0.4.0 distribuye Windows y Apple Silicon; Linux se construye desde fuente y está excluido de la release principal.
- Tests: existen numerosos `#[cfg(test)]` embebidos en Rust y solo tres tests frontend localizados; no se encontró una suite end-to-end de captura/reunión.
- CI: los workflows de validación/build/release observados son principalmente `workflow_dispatch`; el commit del tag tenía cero estados publicados en la API de status. Esto no prueba que no existan checks alternativos, pero no demuestra una puerta automática de calidad por PR.
- Señales de issues: fallos recientes de audio real en Windows, descarga inicial de modelos, compatibilidad CPU, PipeWire/Linux, UI y aceleración. Son reportes, no pruebas reproducidas en esta investigación.
- Los 22.570 stars observados son señal de interés, no evidencia de calidad, seguridad o adecuación a Squaads.

## Riesgos de cadena de suministro y seguridad visibles

No se ejecutó un escáner ni se afirman CVE. La evidencia estática permite señalar:

1. Dependencias Git directas y patches (`silero-rs`, `ffmpeg-sidecar`, `cidre`, CPAL, `esaxx-rs`); algunas fijadas por commit y otras por branch mutable.
2. Descarga de modelos grandes desde URLs externas con validación por tamaño, sin checksum criptográfico visible en la ruta estudiada.
3. Sidecars FFmpeg y `llama-helper` empaquetados con la aplicación; su integridad depende del pipeline de build/release.
4. Un ejecutable `frontend/vs_buildtools.exe` dentro del repositorio, no ejecutado ni necesario para esta investigación; amplía el inventario que debería verificarse.
5. Capacidades Tauri de filesystem amplias y API keys almacenadas en SQLite sin cifrado de aplicación visible.
6. Actualizador firmado configurado con clave pública y artefactos `.sig`, una defensa positiva para distribución desktop.
7. Backend FastAPI/Docker legado declarado sin soporte y con comportamiento histórico no autenticado/CORS; no debe exponerse.

## POC pequeño y seguro para desbloquear ahora

### Recomendación

**No integrar Meetily en el POC.** Desplegar el contenedor actual del worker Squaads, sin cambios funcionales, en un VPS Linux temporal controlado por el equipo. Mantener web en Vercel y los servicios actuales de PostgreSQL/Supabase y S3.

### Alcance

- Una instancia del worker y concurrencia máxima de una reunión.
- Configuración por secretos existentes, sin copiar código Meetily ni instalar modelos.
- Dos reuniones de control cortas y una de 90–120 minutos por proveedor prioritario.
- Prueba explícita de reinicio durante estado seguro y documentación de recuperación manual.
- Observación de CPU, RAM, disco temporal, tamaño MP4, latencia de subida, logs y aceptación del bot/IP.

### Criterios de aceptación

- El bot entra autónomamente en la reunión desde una URL encolada.
- Audio y vídeo completos, reproducibles y sincronizados.
- MP4 privado subido a S3 y referencias persistidas correctamente.
- Transcripción y resumen finalizados sin intervención manual.
- Reunión de 90–120 minutos sin OOM, disco lleno ni pérdida de cola.
- Reinicio no crea dos workers sobre la misma reunión; cualquier claim bloqueado queda identificado y recuperable por procedimiento documentado.
- Métricas de uso y coste quedan registradas; logs no exponen secretos ni contenido sensible.

### Riesgos

- El claim actual no tiene lease/reaper duradero.
- El MP4 completo sigue ocupando memoria/almacenamiento antes de S3.
- IP del VPS o políticas de admisión pueden bloquear al bot.
- El rollback/observabilidad actuales son limitados.

### Rollback

1. Detener y eliminar exclusivamente la instancia temporal del worker.
2. Revocar sus secretos/credenciales y reglas de red.
3. Restaurar cualquier reunión de prueba bloqueada mediante el procedimiento de recovery existente.
4. Conservar web, DB y S3 sin cambios; volver al worker local/entorno anterior.

Este POC es reversible porque no altera contratos, esquema, imagen ni lógica de Squaads.

## Mejoras futuras priorizadas

### Ahora — desbloqueo y seguridad operativa

1. Ejecutar el POC remoto del worker actual con concurrencia uno.
2. Añadir lease/heartbeat y reaper de claims antes de ampliar disponibilidad.
3. Establecer logs estructurados, correlation ID por reunión, alertas y runbook de rollback.
4. Medir disco/memoria y bloquear nuevas reuniones cuando no haya capacidad segura.

### Siguiente — durabilidad multimedia

1. Diseñar grabación fragmentada o subida multipart/streaming a S3 sin acumular el MP4 completo.
2. Mantener manifest de segmentos, checksums, estado de subida y recuperación idempotente.
3. Probar concatenación y sincronía A/V en 90–120 minutos antes de sustituir la ruta actual.
4. Introducir colas limitadas y backpressure; no copiar los canales ilimitados de Meetily.
5. Mejorar estados de provider/modelo, cancelación y reintentos observables.

### Más adelante — producto y calidad

1. Evaluar plantillas de resumen, chunking jerárquico y caché por fingerprint.
2. Incorporar timestamps navegables y trazabilidad resumen→transcript.
3. Investigar diarización como capability independiente y licenciada, no como supuesto de Meetily.
4. Evaluar ASR local solo si privacidad/coste justifican GPU, modelos y operación adicional.
5. Crear SBOM, inventario de modelos/licencias, hashes de descargas y política de actualización.

## Claims no probados, reservados para Pro o desconocidos

| Claim | Evidencia Community v0.4.0 | Evaluación |
|---|---|---|
| “Self-hosted” / “entirely on your infrastructure” | App desktop local; backend Docker marcado legado | **Ambiguo.** En Community significa local, no servidor de equipo |
| “No data ever leaves your computer” | Hay providers cloud, endpoint custom y PostHog opt-in | **Condicional**, solo configuración completamente local |
| Multi-platform macOS/Windows/Linux | Código y workflows Linux; release oficial solo macOS ARM/Windows | **Parcialmente probado**; Linux es build-from-source |
| Captura profesional con ducking | Existe código de ducking alternativo; pipeline activo usa otro mezclador | **No probado como comportamiento activo descrito** |
| GPU automática sin configuración | Features y scripts varían; issues recientes muestran problemas | **No demostrado universalmente** |
| Diarización / identificación | Código antiguo desconectado y PRs abiertos | **No incluido de forma probada en Community v0.4.0** |
| Auto-detectar y entrar en reuniones | README lo lista como ventaja Pro | **Reservado para Pro**, no existe bot Community |
| Self-hosted para equipos | README lo lista en Pro, “different codebase” | **Reservado para Pro**; no auditable en este repo |
| Exportaciones PDF/DOCX/Markdown avanzadas | README las asigna a Pro; Community tiene JSON/audio y PRs de TXT/VTT abiertos | **No probado en Community v0.4.0** |
| GDPR con audit trails | Claim Pro sin código Pro inspeccionable | **No verificable** |
| Enterprise-ready | Sin evidencia Community de multi-tenancy, auth, audit o HA | **Marketing no demostrado por este código** |
| Cifrado en reposo | Se apoya en seguridad del dispositivo; SQLite/API keys sin cifrado propio visible | **No probado como control de aplicación** |
| Docker/server support | Solo backend histórico explícitamente no soportado | **Rechazado para Community actual** |

## Decisión final

Meetily confirma una dirección valiosa —persistir por fragmentos, recuperar tras fallos y desacoplar motores—, pero **no ofrece la pieza que Squaads necesita para desplegarse**. Su unidad operativa es el escritorio del usuario, no un bot remoto. Portar sus subsistemas Rust al worker Bun/Linux tendría un coste y blast radius mayores que desplegar y endurecer el worker existente.

La decisión recomendada es:

1. no usar Meetily para justificar una migración all-on-Vercel;
2. no reemplazar el recorder/browser de Squaads;
3. ejecutar ahora el POC remoto del worker actual;
4. llevar checkpoints, backpressure, contratos de provider y UX de recovery al backlog como patrones a reimplementar con TDD;
5. exigir revisión de procedencia/licencias antes de copiar cualquier código o redistribuir modelos.

## Índice de fuentes y evidencia

### Código Meetily en el commit inspeccionado

- `README.md` — claims Community/Pro, OS, proveedores y acknowledgments.
- `LICENSE.md` — licencia MIT raíz.
- `.gitmodules` — submódulo whisper.cpp y commit fijado.
- `frontend/next.config.js` — export estático Next.js.
- `frontend/src-tauri/tauri.conf.json` — desktop bundle, permisos, sidecars y updater.
- `frontend/src-tauri/Cargo.toml` — dependencias, features CPU/GPU y forks Git.
- `frontend/src/services/recordingService.ts` — comandos UI→Tauri.
- `frontend/src-tauri/src/audio/recording_commands.rs` — lifecycle y shutdown.
- `frontend/src-tauri/src/audio/recording_manager.rs` — orquestación activa.
- `frontend/src-tauri/src/audio/stream.rs` — apertura/cierre de streams.
- `frontend/src-tauri/src/audio/pipeline.rs` — mezcla activa, VAD y colas.
- `frontend/src-tauri/src/audio/capture/core_audio.rs` — captura macOS.
- `frontend/src-tauri/src/audio/devices/platform/{windows,macos,linux}.rs` — selección por OS.
- `frontend/src-tauri/src/audio/incremental_saver.rs` — checkpoints y recovery.
- `frontend/src-tauri/src/audio/recording_saver.rs` — archivos y metadatos.
- `frontend/src-tauri/src/audio/transcription/{provider,engine,worker}.rs` — contrato y ejecución ASR.
- `frontend/src-tauri/src/whisper_engine/` — Whisper y modelos.
- `frontend/src-tauri/src/parakeet_engine/` — Parakeet ONNX.
- `frontend/src-tauri/src/audio/stt.rs` — diarización antigua no conectada.
- `frontend/src-tauri/src/summary/{llm_client,processor,service}.rs` — providers y pipeline de resumen.
- `frontend/src-tauri/src/summary/summary_engine/{models,model_manager,sidecar}.rs` — modelos locales.
- `frontend/src-tauri/src/database/` — SQLite y repositorios.
- `frontend/src-tauri/src/analytics/` y `PRIVACY_POLICY.md` — telemetría y claims de privacidad.
- `backend/README.md` — declaración explícita de backend Docker legado.
- `.github/workflows/` — builds y release desktop.

### Repositorio y metadatos oficiales

- Repositorio: <https://github.com/Zackriya-Solutions/meetily>
- Release v0.4.0: <https://github.com/Zackriya-Solutions/meetily/releases/tag/v0.4.0>
- Issues: <https://github.com/Zackriya-Solutions/meetily/issues>
- Pull requests: <https://github.com/Zackriya-Solutions/meetily/pulls>

### Documentación oficial y licencias externas

- Tauri Architecture: <https://v2.tauri.app/concept/architecture/>
- Tauri Calling Rust: <https://v2.tauri.app/develop/calling-rust/>
- Tauri Sidecars: <https://v2.tauri.app/develop/sidecar/>
- Next.js Static Exports: <https://nextjs.org/docs/app/guides/static-exports>
- whisper.cpp MIT: <https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE>
- Parakeet NVIDIA model card/CC BY 4.0: <https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3>
- Conversión ONNX Parakeet/CC BY 4.0: <https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx>
- Qwen 3.5 2B GGUF/Apache-2.0: <https://huggingface.co/unsloth/Qwen3.5-2B-GGUF>
- Gemma terms/model card: <https://huggingface.co/google/gemma-3-4b-it>
- CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/legalcode.en>
- Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>
