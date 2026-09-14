import type {
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "@/integrations/ai/text/TextGenerationProvider";
import { DeepSeekTextProvider } from "@/integrations/ai/text/providers/DeepSeekTextProvider";
import { GeminiTextProvider } from "@/integrations/ai/text/providers/GeminiTextProvider";

/**
 * Factory del camino de texto (spec 017).
 *
 * La lógica de negocio llama a `generate()` y no decide nada por proveedor: la selección, el respaldo y
 * el orden viven aquí. Es el patrón que la constitución prescribe para la variación por proveedor.
 */
const TEXT_PROVIDER_BUILDERS: Record<string, () => TextGenerationProvider> = {
  deepseek: () => new DeepSeekTextProvider(),
  gemini: () => new GeminiTextProvider(),
};

function getAutoProviderName(): string | null {
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

export class TextGenerationProviderFactory {
  static isConfigured(): boolean {
    return Boolean(process.env.TEXT_PROVIDER || getAutoProviderName());
  }

  static getProvider(): TextGenerationProvider {
    const providerName = process.env.TEXT_PROVIDER?.toLowerCase() || getAutoProviderName();

    if (!providerName) {
      throw new Error("No text provider configured. Set TEXT_PROVIDER or DEEPSEEK_API_KEY/GEMINI_API_KEY.");
    }

    const build = TEXT_PROVIDER_BUILDERS[providerName];
    if (!build) {
      const supported = Object.keys(TEXT_PROVIDER_BUILDERS).join(", ");
      throw new Error(`Unsupported text provider "${providerName}". Supported: ${supported}`);
    }

    return build();
  }

  /** El otro proveedor configurado, si lo hay, para usarlo como respaldo. */
  static getFallbackProvider(primaryName: string): TextGenerationProvider | null {
    for (const name of Object.keys(TEXT_PROVIDER_BUILDERS)) {
      if (name === primaryName) continue;
      const provider = TEXT_PROVIDER_BUILDERS[name]();
      if (provider.isConfigured()) return provider;
    }
    return null;
  }

  /**
   * Genera texto con el proveedor primario y cae al respaldo si el primario falla.
   * Lanza si ninguno está configurado o si ambos fallan: el llamante decide cómo degradar.
   */
  static async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const primary = this.getProvider();

    try {
      return await primary.generate(request);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = this.getFallbackProvider(primary.name);

      if (!fallback) {
        throw new Error(`${primary.name} falló y no hay respaldo configurado: ${message}`);
      }

      console.warn(`[textProvider] ${primary.name} falló (${message.slice(0, 160)}), respaldo ${fallback.name}...`);
      return fallback.generate(request);
    }
  }
}
