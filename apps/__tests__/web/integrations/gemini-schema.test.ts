/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  toGeminiSchema,
  toGeminiType,
} from "../../../web/src/integrations/chat/tools/geminiSchema";

describe("toGeminiType", () => {
  it("mapea los tipos JSON Schema a los tipos Gemini en mayúsculas", () => {
    expect(toGeminiType("string")).toBe("STRING");
    expect(toGeminiType("number")).toBe("NUMBER");
    expect(toGeminiType("boolean")).toBe("BOOLEAN");
    expect(toGeminiType("array")).toBe("ARRAY");
    expect(toGeminiType("object")).toBe("OBJECT");
  });

  it("cae a STRING ante un tipo desconocido", () => {
    expect(toGeminiType("null")).toBe("STRING");
    expect(toGeminiType("")).toBe("STRING");
  });
});

describe("toGeminiSchema", () => {
  it("convierte description, enum, properties, required e items", () => {
    const schema = toGeminiSchema({
      type: "object",
      properties: {
        status: { type: "string", enum: ["completed", "error"], description: "Estado" },
        limit: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
        nested: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        empty: { type: "object", properties: {} },
      },
      required: ["status"],
    });

    expect(schema.type).toBe("OBJECT");
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.status).toEqual({
      type: "STRING",
      description: "Estado",
      enum: ["completed", "error"],
    });
    expect(properties.limit).toEqual({ type: "NUMBER" });
    expect(properties.tags).toEqual({ type: "ARRAY", items: { type: "STRING" } });
    expect(properties.nested).toEqual({
      type: "OBJECT",
      properties: { query: { type: "STRING" } },
      required: ["query"],
    });
    expect(properties.empty).toEqual({ type: "OBJECT", properties: {} });
    expect(schema.required).toEqual(["status"]);
  });

  it("no muta el schema de entrada", () => {
    const input = { type: "string", description: "x" };
    const output = toGeminiSchema(input);

    expect(input).toEqual({ type: "string", description: "x" });
    expect(output).not.toBe(input);
  });
});
