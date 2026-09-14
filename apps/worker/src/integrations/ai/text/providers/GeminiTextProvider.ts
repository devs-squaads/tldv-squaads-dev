import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "@/integrations/ai/text/TextGenerationProvider";
import { getAiModels } from "@/services/aiModels";
import { resolveProviderTimeoutMs, withTimeout } from "@/services/providerTimeout";

/**
 * Gemini para texto: respaldo del camino de texto y, sobre todo, el proveedor de audio
 * (`GeminiTranscriptionProvider`).
 *
 * NUNCA se envía `maxOutputTokens`: un tope artificial trunca la respuesta.
 */
export class GeminiTextProvider implements TextGenerationProvider {
  readonly name = "gemini";
  readonly model = getAiModels().geminiModel;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: this.model,
      generationConfig: { temperature: request.temperature ?? 0.2 },
    });

    const prompt = request.system ? `${request.system}\n\n${request.user}` : request.user;
    // El SDK no expone timeout: se acota por fuera para que un proveedor estancado no cuelgue el
    // pipeline de la reunión.
    const result = await withTimeout(
      model.generateContent(prompt),
      resolveProviderTimeoutMs(),
      `Gemini texto (${this.model})`,
    );
    const text = result.response.text().trim();

    const finishReason = (result.response.candidates?.[0] as { finishReason?: string } | undefined)
      ?.finishReason;

    return {
      text,
      truncated: finishReason === "MAX_TOKENS",
      provider: this.name,
      model: this.model,
    };
  }
}
