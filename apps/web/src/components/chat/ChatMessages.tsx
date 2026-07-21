"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { DisplayMessage } from "@/components/chat/useChatStream";
import { Bot, User, LayoutDashboard, Puzzle, FileText, Cpu, HeadphonesIcon } from "lucide-react";

/** Minimal Markdown-like renderer — no external deps */
function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Ordered list item
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="my-2 ml-4 list-decimal space-y-1">
          {items.map((item, idx) => (
            <li key={idx} className="text-sm leading-relaxed">
              <InlineText text={item} />
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Unordered list item
    if (/^[-*•]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*•]\s/, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="my-2 ml-4 list-disc space-y-1">
          {items.map((item, idx) => (
            <li key={idx} className="text-sm leading-relaxed">
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Normal paragraph
    nodes.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed">
        <InlineText text={line} />
      </p>
    );
    i++;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {nodes}
      {isStreaming && (
        <span className="inline-flex items-center gap-[3px] mt-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: "#00F2FF",
                animation: "typingDot 1.2s ease-in-out infinite",
                animationDelay: `${i * 0.18}s`,
              }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/** Renders **bold** and `code` inline */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded px-1 py-0.5 text-[11px] font-mono"
              style={{ background: "rgba(0,242,255,0.1)", color: "#00F2FF" }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

interface ChatMessagesProps {
  messages: DisplayMessage[];
  onQuickReply: (question: string, answer: string) => void;
}

interface TopicCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

function TopicCard({ icon: Icon, label, onClick }: TopicCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3.5 rounded-xl px-3.5 py-3.5 text-left transition-all duration-200 active:scale-[0.985]"
      style={{
        background: "var(--card)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        border: "1px solid var(--glass-border)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,242,255,0.35)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 12px rgba(0,242,255,0.07)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--glass-border)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 group-hover:bg-[rgba(0,242,255,0.14)]"
        style={{
          background: "rgba(0,242,255,0.07)",
          border: "1px solid rgba(0,242,255,0.18)",
        }}
      >
        <Icon className="h-[18px] w-[18px] text-[#00F2FF]" />
      </span>
      <span className="block text-sm font-semibold text-[var(--foreground)] leading-snug">
        {label}
      </span>
    </button>
  );
}

const STARTER_TOPICS = [
  {
    icon: LayoutDashboard,
    label: "Dashboard y reuniones",
    question: "¿Cómo gestiono mis reuniones desde el dashboard?",
    answer: `Desde el dashboard podés gestionar todas tus reuniones en un solo lugar.

**Lo que podés hacer:**
- Ver el listado completo con el estado de cada reunión
- Encolar una reunión nueva pegando la URL de Google Meet, Teams o Zoom
- Ver el detalle: transcripción, resumen, action items y key moments
- Regenerar el resumen si falló
- Compartir una reunión con link público o restringido por email

**Estados que vas a ver:**
- **pending** → en cola, esperando al worker
- **recording** → el bot está grabando en este momento
- **transcribing / summarizing** → procesando el audio
- **completed** → listo para leer
- **error** → algo falló, el detalle de la reunión muestra el motivo`,
  },
  {
    icon: Puzzle,
    label: "Extensión Chrome",
    question: "¿Cómo instalo y conecto la extensión al sistema?",
    answer: `La extensión te permite invitar al bot directamente desde la reunión.

**Instalación:**
1. Dashboard → "Instalar Extensión" → descargar ZIP
2. Descomprimir el ZIP en una carpeta local
3. Abrir chrome://extensions/ → activar "Modo desarrollador"
4. "Cargar descomprimida" → seleccionar la carpeta (NO el ZIP)
5. Confirmar que aparece habilitada en la lista

**Conexión al sistema:**
1. Dashboard → "Generar token de conexión"
2. Popup de la extensión → pegar token → "Connect to Current Site"

**Errores frecuentes:**
- **"Manifest file is missing"**: cargaste el ZIP directo, descomprimí primero
- **Token inválido**: los tokens son efímeros, generá uno nuevo desde el dashboard
- **"Could not connect"**: verificá que el servidor web esté corriendo`,
  },
  {
    icon: FileText,
    label: "Transcripciones",
    question: "¿Por qué puede fallar una transcripción y cómo la soluciono?",
    answer: `Las transcripciones pueden fallar por varias razones.

**Causas más comunes:**
- **GROQ_API_KEY no configurada o con créditos agotados** → verificar en Settings
- **Archivo de audio corrupto o vacío** → ocurre si la grabación se interrumpió antes de terminar
- **Reunión muy larga** → el límite de Groq Whisper es 25MB de audio
- **Problemas de conectividad** con la API de Groq

**Cómo diagnosticarlo:**
1. Ir al detalle de la reunión → revisar el estado y el mensaje de error
2. Settings → confirmar que GROQ_API_KEY esté configurada y tenga créditos
3. Si el archivo está corrupto, la reunión no tiene solución — hay que repetirla

**Alternativa:** Podés configurar Deepgram como provider de transcripción en Settings si Groq sigue fallando.`,
  },
  {
    icon: Cpu,
    label: "Cómo funciona el sistema",
    question: "¿Cómo funciona el flujo completo de grabación y resumen?",
    answer: `El sistema tiene dos servicios que trabajan juntos.

**Servicio Web:** dashboard, autenticación y APIs. Solo encola reuniones y muestra resultados.

**Servicio Worker:** el motor — ejecuta el bot, graba y procesa todo.

**Flujo completo:**
1. **pending** → reunión encolada (manual o por auto-join con Google Calendar)
2. **joining** → Puppeteer abre el navegador y navega a la URL
3. **waiting_admission** → el bot espera ser admitido a la sala
4. **recording** → FFmpeg captura audio y video en tiempo real
5. **transcribing** → el audio se envía a Groq Whisper (o Deepgram)
6. **summarizing** → la transcripción se envía a Gemini para generar el resumen
7. **completed** → transcripción, resumen, action items y key moments disponibles

Todo se guarda en PostgreSQL. Los archivos de video/audio van a S3/MinIO.`,
  },
  {
    icon: HeadphonesIcon,
    label: "Soporte",
    question: "¿Cómo puedo contactar al equipo de soporte?",
    answer: `¿No encontrás lo que buscás o algo no está funcionando como esperás?

**Lo que podés hacer ahora:**
- Describí tu problema directamente en este chat — tengo acceso al estado de tus reuniones y configuración del sistema para ayudarte a diagnosticar
- Si el problema está relacionado con una reunión específica, mencioná el ID o la fecha
- Usá el botón "Reportar un problema" que aparece debajo de esta respuesta para enviar tu reporte directo al canal de soporte del equipo

Si el asistente no puede resolver tu problema, contame qué está pasando y te orientamos en los próximos pasos.`,
  },
] as const;

export function ChatMessages({ messages, onQuickReply }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6 gap-5">
        {/* Avatar + greeting */}
        <div className="flex flex-col items-center gap-3 text-center pt-2">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background: "rgba(0,242,255,0.06)",
              border: "1px solid rgba(0,242,255,0.25)",
              boxShadow: "0 0 28px rgba(0,242,255,0.12)",
            }}
          >
            <Bot className="h-8 w-8 text-[#00F2FF]" />
          </div>

          <div>
            <p className="text-base font-semibold text-[var(--foreground)]">
              Hola, soy el Squaads Assistant
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)] leading-relaxed max-w-[240px]">
              Estoy aquí para ayudarte con el sistema. Podés preguntarme lo que necesites o elegir un tema para empezar.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "var(--glass-border)" }} />
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
            ¿en qué te puedo ayudar?
          </span>
          <div className="flex-1 h-px" style={{ background: "var(--glass-border)" }} />
        </div>

        {/* Topic cards — ordered list */}
        <div className="flex flex-col gap-2.5">
          {STARTER_TOPICS.map(({ icon: Icon, label, question, answer }) => (
            <TopicCard
              key={label}
              icon={Icon}
              label={label}
              onClick={() => onQuickReply(question, answer)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
        >
          {/* Avatar */}
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5"
            style={
              msg.role === "assistant"
                ? {
                    background: "rgba(0,242,255,0.08)",
                    border: "1px solid rgba(0,242,255,0.2)",
                  }
                : {
                    background: "var(--secondary)",
                    border: "1px solid var(--glass-border)",
                  }
            }
          >
            {msg.role === "assistant" ? (
              <Bot className="h-3.5 w-3.5 text-[#00F2FF]" />
            ) : (
              <User className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            )}
          </div>

          {/* Bubble */}
          <div
            className="max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
            style={
              msg.role === "user"
                ? {
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                    borderRadius: "16px 4px 16px 16px",
                  }
                : {
                    background: "var(--card)",
                    backdropFilter: "blur(12px) saturate(1.4)",
                    WebkitBackdropFilter: "blur(12px) saturate(1.4)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--foreground)",
                    borderRadius: "4px 16px 16px 16px",
                  }
            }
          >
            {msg.role === "assistant" ? (
              <MessageContent content={msg.content} isStreaming={msg.isStreaming} />
            ) : (
              <span className="text-sm leading-relaxed">{msg.content}</span>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
