/**
 * Mapeo JSON Schema → Gemini.
 *
 * Única copia del mapeo: lo usan el provider de chat de texto
 * (`GeminiChatProvider`) y el constructor de restricciones de voz
 * (`liveTokenRequest`). Dos copias divergen; esta es la fuente de verdad.
 */

const TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

export function toGeminiType(type: string): string {
  return TYPE_MAP[type] ?? "STRING";
}

export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: toGeminiType(schema.type as string),
  };

  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;

  if (schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    result.properties = Object.fromEntries(
      Object.entries(props).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }

  if (schema.required) result.required = schema.required;

  if (schema.items) {
    result.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }

  return result;
}
