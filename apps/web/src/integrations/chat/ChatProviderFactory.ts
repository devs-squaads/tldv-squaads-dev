import type { ChatProvider } from "@/integrations/chat/ChatProvider";
import { GeminiChatProvider } from "@/integrations/chat/GeminiChatProvider";
import { GroqChatProvider } from "@/integrations/chat/GroqChatProvider";

const CHAT_PROVIDER_BUILDERS: Record<string, () => ChatProvider> = {
  groq: () => new GroqChatProvider(),
  gemini: () => new GeminiChatProvider(),
};

export type ChatProviderName = keyof typeof CHAT_PROVIDER_BUILDERS;

export interface ChatProviderResolution {
  configuredProvider: string | null;
  effectiveProvider: ChatProviderName | null;
  fallbackProvider: ChatProviderName | null;
  resolutionSource: "configured" | "auto" | "none" | "invalid-configured";
}

function isChatProviderName(value: string): value is ChatProviderName {
  return value in CHAT_PROVIDER_BUILDERS;
}

function getAutoProviderName(): string | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

function buildProvider(providerName: ChatProviderName): ChatProvider {
  return CHAT_PROVIDER_BUILDERS[providerName]();
}

export class ChatProviderFactory {
  static resolveProviderResolution(): ChatProviderResolution {
    const configuredProvider = process.env.CHAT_PROVIDER?.trim().toLowerCase() || null;

    if (configuredProvider) {
      if (!isChatProviderName(configuredProvider)) {
        return {
          configuredProvider,
          effectiveProvider: null,
          fallbackProvider: null,
          resolutionSource: "invalid-configured",
        };
      }

      const fallbackProvider = configuredProvider === "gemini"
        ? (process.env.GROQ_API_KEY ? "groq" : null)
        : (process.env.GEMINI_API_KEY ? "gemini" : null);

      return {
        configuredProvider,
        effectiveProvider: configuredProvider,
        fallbackProvider,
        resolutionSource: "configured",
      };
    }

    const effectiveProvider = getAutoProviderName();
    if (!effectiveProvider || !isChatProviderName(effectiveProvider)) {
      return {
        configuredProvider: null,
        effectiveProvider: null,
        fallbackProvider: null,
        resolutionSource: "none",
      };
    }

    const fallbackProvider = effectiveProvider === "gemini"
      ? (process.env.GROQ_API_KEY ? "groq" : null)
      : (process.env.GEMINI_API_KEY ? "gemini" : null);

    return {
      configuredProvider: null,
      effectiveProvider,
      fallbackProvider,
      resolutionSource: "auto",
    };
  }

  static isConfigured(): boolean {
    return ChatProviderFactory.resolveProviderResolution().effectiveProvider !== null;
  }

  static getProvider(): ChatProvider {
    const resolution = ChatProviderFactory.resolveProviderResolution();
    const providerName = resolution.effectiveProvider;

    if (!providerName) {
      if (resolution.resolutionSource === "invalid-configured") {
        const supported = Object.keys(CHAT_PROVIDER_BUILDERS).join(", ");
        throw new Error(
          `Unsupported chat provider "${resolution.configuredProvider}". Supported: ${supported}`,
        );
      }

      throw new Error(
        "No chat provider configured. Set CHAT_PROVIDER or provide GROQ_API_KEY / GEMINI_API_KEY."
      );
    }

    return buildProvider(providerName);
  }

  /**
   * Returns a provider with automatic fallback.
   * Tries the primary provider; if it throws on construction, falls back to the other.
   */
  static getProviderWithFallback(): ChatProvider {
    const resolution = ChatProviderFactory.resolveProviderResolution();

    try {
      if (!resolution.effectiveProvider) {
        return ChatProviderFactory.getProvider();
      }

      return buildProvider(resolution.effectiveProvider);
    } catch {
      if (resolution.fallbackProvider) {
        return buildProvider(resolution.fallbackProvider);
      }

      throw new Error("No chat provider available. Configure GEMINI_API_KEY or GROQ_API_KEY.");
    }
  }

  /**
   * Returns the fallback provider (the one that is NOT the primary).
   * Used for runtime fallback when the primary provider fails mid-stream
   * (e.g. 429 rate limit, quota exceeded).
   * Returns null if no fallback is available.
   */
  static getFallbackProvider(): ChatProvider | null {
    const fallbackProvider = ChatProviderFactory.resolveProviderResolution().fallbackProvider;
    return fallbackProvider ? buildProvider(fallbackProvider) : null;
  }
}
