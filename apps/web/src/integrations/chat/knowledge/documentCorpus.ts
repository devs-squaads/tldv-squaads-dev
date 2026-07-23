export interface KnowledgeDocument {
  id: string;
  title: string;
  tags: string[];
  content: string;
}

/**
 * Corpus curado web-only para preguntas documentales.
 * No contiene datos operativos dinámicos (eso sigue yendo por tools).
 */
export const CHAT_DOCUMENT_CORPUS: KnowledgeDocument[] = [
  {
    id: "overview-system",
    title: "Qué es Squaads Bot",
    tags: ["overview", "arquitectura", "sistema"],
    content:
      "Squaads Bot es un sistema self-hosted para grabar reuniones online, transcribirlas y generar resúmenes. Soporta Google Meet, Microsoft Teams y Zoom web.",
  },
  {
    id: "architecture-web-worker",
    title: "Arquitectura web + worker",
    tags: ["arquitectura", "web", "worker"],
    content:
      "apps/web maneja dashboard, autenticación y APIs ligeras. apps/worker ejecuta Puppeteer + FFmpeg y el pipeline de transcripción/resumen. Ambos comparten PostgreSQL y S3/MinIO.",
  },
  {
    id: "meeting-lifecycle",
    title: "Estados de reunión",
    tags: ["estados", "meeting", "pipeline"],
    content:
      "Flujo: pending → joining → waiting_admission → recording → transcribing → summarizing → completed. Errores comunes: error, rejected, admission_timeout.",
  },
  {
    id: "autojoin-calendar",
    title: "Auto-join con Google Calendar",
    tags: ["calendar", "autojoin", "settings"],
    content:
      "El worker hace polling de Google Calendar y encola reuniones próximas de organizadores permitidos. Se configura en Settings con credenciales de Service Account y emails de organizadores.",
  },
  {
    id: "extension-install",
    title: "Instalación de extensión Chrome",
    tags: ["extension", "instalacion", "chrome"],
    content:
      "Pasos: descargar ZIP desde dashboard, descomprimir, abrir chrome://extensions, activar modo desarrollador, cargar carpeta descomprimida que contiene manifest.json.",
  },
  {
    id: "extension-connect",
    title: "Conexión de extensión",
    tags: ["extension", "token", "conexion"],
    content:
      "Desde dashboard se genera token efímero. En el popup de la extensión se pega el token y se conecta al sitio actual.",
  },
  {
    id: "extension-troubleshooting",
    title: "Errores comunes de extensión",
    tags: ["extension", "errores", "troubleshooting"],
    content:
      "Manifest file is missing suele indicar que se cargó el ZIP sin descomprimir. Token inválido se resuelve generando uno nuevo. Could not connect suele indicar que el servidor web no está disponible.",
  },
  {
    id: "troubleshooting-transcription",
    title: "Transcripción fallida",
    tags: ["transcripcion", "errores", "api"],
    content:
      "Verificar GROQ_API_KEY o DEEPGRAM_API_KEY, conectividad y tamaño/calidad del audio. Si falta la transcripción, revisar estado de la reunión y logs del worker.",
  },
  {
    id: "troubleshooting-summary",
    title: "Resumen no generado",
    tags: ["resumen", "errores", "api"],
    content:
      "Verificar GEMINI_API_KEY y fallback disponible. Si la transcripción existe pero no hay resumen, usar la acción de regenerar resumen en el detalle de la reunión.",
  },
  {
    id: "troubleshooting-pending",
    title: "Reunión atascada en pending",
    tags: ["pending", "worker", "errores"],
    content:
      "Si una reunión queda en pending, validar que el worker esté activo. El worker procesa una reunión a la vez, por lo que puede haber cola.",
  },
  {
    id: "settings-storage",
    title: "Settings y almacenamiento",
    tags: ["settings", "storage", "configuracion", "equipo", "service", "account", "cuenta", "servicio"],
    content:
      "Settings incluye la configuración de transcripción, resumen y auto-join, más la gestión del Equipo (Ajustes → Equipo): cada admin puede cambiar el rol de una cuenta, activarla o desactivarla, y eliminarla (pide confirmación, no se puede deshacer). En Ajustes → General → avanzado está la Cuenta de servicio de Google (opcional): permite que el bot se una automáticamente a reuniones de un calendario compartido sin que cada persona conecte su cuenta individualmente; necesita un archivo de credenciales (JSON) generado por un administrador desde Google Cloud Console. Metadatos/transcripciones/resúmenes viven en PostgreSQL y archivos multimedia en S3/MinIO.",
  },
  {
    id: "team-roles",
    title: "Roles de equipo: admin y member",
    tags: [
      "roles",
      "rol",
      "admin",
      "administrador",
      "member",
      "miembro",
      "permisos",
      "equipo",
      "compañero",
      "autorizar",
      "gestionar",
      "cambiar",
      "cambio",
    ],
    content:
      "Quién puede gestionar el equipo es una pregunta común: solo los admin pueden autorizar cuentas nuevas y cambiar el rol de un compañero (cambio de admin a member o viceversa). Los member tienen acceso de solo lectura a la gestión del equipo, sin permisos para modificar roles ni cuentas. Para ver o cambiar el rol de un compañero, entrá a Settings (acción open_settings) y abrí la sección Equipo.",
  },
  {
    id: "auth-gate-login",
    title: "Acceso protegido y redirección a login",
    tags: ["login", "redirigido", "redirigió", "redirección", "sesión", "acceso", "autenticación", "protegido", "iniciar"],
    content:
      "Todas las páginas del dashboard requieren sesión iniciada. Si la sesión expiró o no existe, el middleware te redirigió a login automáticamente antes de mostrar cualquier página protegida. Es el comportamiento esperado: basta volver a iniciar sesión con tu cuenta autorizada para recuperar el acceso.",
  },
  {
    id: "database-security",
    title: "Seguridad de tus datos (RLS)",
    tags: ["seguridad", "datos", "protegido", "protegidos", "privacidad", "rls", "aislamiento", "base"],
    content:
      "Tus datos están protegidos y aislados a nivel de base de datos: cada cuenta solo puede ver y modificar su propia información gracias a Row Level Security (RLS) en PostgreSQL/Supabase. Nota para operadores: RLS está activo en modo deny-by-default en todas las tablas del schema public, así que cualquier tabla nueva queda bloqueada hasta que se le agregue una policy explícita.",
  },
  {
    id: "transcription-handling",
    title: "Cómo responder sobre transcripciones",
    tags: ["transcripcion", "tooling", "reglas"],
    content:
      "Para mostrar transcripciones reales hay que obtener datos desde herramientas. No inventar ni resumir contenido que no venga de resultados reales.",
  },
  {
    id: "date-without-month-rule",
    title: "Regla para fecha sin mes",
    tags: ["fechas", "reglas", "operativo"],
    content:
      "Si el usuario pide algo como 'grabaciones del día 24' sin indicar mes, solo inferí el mes cuando el contexto previo lo haga inequívoco. Si no hay contexto suficiente, pedí que confirme el mes en lugar de inventarlo.",
  },
  {
    id: "format-guidelines",
    title: "Formato de respuesta",
    tags: ["formato", "estilo"],
    content:
      "Responder en tono conversacional, sin encabezados tipo informe. Usar párrafos cortos y listas simples con guiones o numeración.",
  },
  {
    id: "support-report-problem",
    title: "Cómo escalar un problema al soporte",
    tags: ["soporte", "reporte", "problema", "bug"],
    content:
      "Para escalar un problema al equipo, el usuario abre el tema Soporte en el chat y presiona el botón 'Reportar un problema', que aparece debajo de esa respuesta. El reporte se envía directamente al canal de soporte del equipo. Esta funcionalidad ya está disponible, no es un desarrollo futuro.",
  },
  {
    id: "suggestions-guidelines",
    title: "Reglas del bloque de sugerencias",
    tags: ["suggestions", "ui", "navegacion"],
    content:
      "Las acciones view_meetings, view_meeting_detail, view_transcription, install_extension y open_settings son botones de UI dentro del bloque [SUGGESTIONS], no tool calls.",
  },
];
