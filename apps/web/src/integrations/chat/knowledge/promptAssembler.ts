import { requiresDataTool } from "@/integrations/chat/tools/suggestionValidator";
import {
  BASE_CHAT_RULES,
  VOICE_CHAT_RULES,
} from "@/integrations/chat/knowledge/staticKnowledge";
import {
  retrieveKnowledgeSnippets,
  type RetrievedSnippet,
} from "@/integrations/chat/knowledge/documentRetrieval";

const DEFAULT_SNIPPET_COUNT = 4;

/** Canal de salida: el texto parsea sugerencias de UI, la voz no puede emitirlas. */
export type ChatChannel = "text" | "voice";

export interface PromptAssembly {
  systemContent: string;
  snippets: RetrievedSnippet[];
  mode: "operational" | "documental";
}

function getLatestUserMessage(messages: Array<{ role: string; content: string }>): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function formatSnippetBlock(snippets: RetrievedSnippet[]): string {
  if (!snippets.length) return "";

  const lines = snippets.map(
    (snippet, index) =>
      `${index + 1}. [${snippet.title}] ${snippet.snippet}`,
  );

  return `Contexto documental recuperado (usalo solo si aplica a la consulta):\n${lines.join("\n")}`;
}

export function assembleChatSystemPrompt(input: {
  messages: Array<{ role: string; content: string }>;
  userContext: string;
  topK?: number;
  channel?: ChatChannel;
}): PromptAssembly {
  const latestUserMessage = getLatestUserMessage(input.messages);
  const operational = requiresDataTool(latestUserMessage);

  const snippets = operational
    ? []
    : retrieveKnowledgeSnippets(latestUserMessage, { topK: input.topK ?? DEFAULT_SNIPPET_COUNT });

  const baseRules = input.channel === "voice" ? VOICE_CHAT_RULES : BASE_CHAT_RULES;

  const sections = [
    baseRules.trim(),
    "Política de fuentes de verdad: datos operativos de reuniones y transcripciones reales deben salir de herramientas; la documentación recuperada es soporte explicativo.",
    formatSnippetBlock(snippets),
    input.userContext.trim(),
  ].filter((section) => section && section.length > 0);

  return {
    systemContent: sections.join("\n\n"),
    snippets,
    mode: operational ? "operational" : "documental",
  };
}
