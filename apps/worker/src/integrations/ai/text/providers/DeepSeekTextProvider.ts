import type {
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "@/integrations/ai/text/TextGenerationProvider";
import { getAiModels } from "@/services/aiModels";
import { resolveProviderTimeoutMs, withTimeout } from "@/services/providerTimeout";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/**
 * DeepSeek para texto. API compatible con OpenAI; se llama con `fetch` porque el control del
 * razonamiento (`thinking`) es específico de DeepSeek y no encaja en los tipos del SDK.
 *
 * NUNCA se envía `max_tokens`: un tope artificial trunca la reemisión del texto.
 */
export class DeepSeekTextProvider implements TextGenerationProvider {
  readonly name = "deepseek";
  readonly model = getAiModels().deepseekModel;

  isConfigured(): boolean {
    return Boolean(process.env.DEEPSEEK_API_KEY);
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY no está configurada");

    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.user });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.2,
    };

    // El razonamiento se desactiva en las tareas de copia: medido, 7,7 s frente a 23,1 s y cero
    // tokens de razonamiento, con el mismo resultado.
    if (request.reasoning === "off") {
      body.thinking = { type: "disabled" };
    }

    // Se acota la espera: un proveedor que responde las cabeceras y estanca el cuerpo dejaría el
    // pipeline de la reunión colgado para siempre. Pasó de verdad con este API.
    const timeoutMs = resolveProviderTimeoutMs();

    const payload = await withTimeout(
      (async () => {
        const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          error?: { message?: string };
        };

        if (!response.ok || !json.choices) {
          throw new Error(
            `DeepSeek rechazó la petición (${response.status}): ${json.error?.message ?? "sin detalle"}`,
          );
        }

        return json;
      })(),
      timeoutMs,
      `DeepSeek (${this.model})`,
    );

    const choice = payload.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";

    return {
      text,
      truncated: choice?.finish_reason === "length",
      provider: this.name,
      model: this.model,
    };
  }
}
