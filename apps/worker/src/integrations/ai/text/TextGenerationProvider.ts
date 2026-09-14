/**
 * Contrato de generación de texto (spec 017).
 *
 * Existe para sacar de la lógica de negocio las ramas por proveedor: antes, `gemini.ts` y
 * `speakerAttribution.ts` decidían a mano entre Groq y Gemini, lo que la constitución prohíbe. Aquí la
 * variación se resuelve extendiendo el contrato y su factory.
 */

/**
 * Modo de razonamiento.
 *
 * `off` para tareas mecánicas de copia (atribución de hablantes, refiner): el razonamiento no aporta y
 * consume tiempo y presupuesto interno. `auto` cuando el modelo debe juzgar (resumen, capítulos).
 */
export type ReasoningMode = "off" | "auto";

export interface TextGenerationRequest {
  /** Instrucción del usuario (el prompt completo). */
  user: string;
  /** Instrucción de sistema, si el proveedor la soporta. */
  system?: string;
  temperature?: number;
  reasoning?: ReasoningMode;
}

export interface TextGenerationResult {
  text: string;
  /** El proveedor cortó la respuesta por su propio límite de salida. */
  truncated: boolean;
  provider: string;
  model: string;
}

export interface TextGenerationProvider {
  readonly name: string;
  /** Modelo por defecto que usaría este proveedor. */
  readonly model: string;
  isConfigured(): boolean;
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}
