/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  resolveProviderTimeoutMs,
  withTimeout,
} from "../../../worker/src/services/providerTimeout";

describe("resolveProviderTimeoutMs (spec 017)", () => {
  it("uses a bounded default when nothing is configured", () => {
    expect(resolveProviderTimeoutMs({})).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
  });

  it("honours a configured value", () => {
    expect(resolveProviderTimeoutMs({ PROVIDER_TIMEOUT_MS: "45000" })).toBe(45000);
  });

  it("ignores a nonsensical value instead of disabling the guard", () => {
    expect(resolveProviderTimeoutMs({ PROVIDER_TIMEOUT_MS: "0" })).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(resolveProviderTimeoutMs({ PROVIDER_TIMEOUT_MS: "-5" })).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
    expect(resolveProviderTimeoutMs({ PROVIDER_TIMEOUT_MS: "abc" })).toBe(DEFAULT_PROVIDER_TIMEOUT_MS);
  });
});

describe("withTimeout (spec 017)", () => {
  it("returns the value when the promise resolves in time", async () => {
    const result = await withTimeout(Promise.resolve("listo"), 1000, "prueba");

    expect(result).toBe("listo");
  });

  it("rejects with a labelled error when the promise never settles", async () => {
    // El caso real: un proveedor que acepta la petición y estanca la respuesta.
    const never = new Promise<string>(() => undefined);

    await expect(withTimeout(never, 30, "DeepSeek")).rejects.toThrow(/DeepSeek.*límite/);
  });

  it("propaga el error original si la promesa falla antes", async () => {
    const failing = Promise.reject(new Error("fallo del proveedor"));

    await expect(withTimeout(failing, 1000, "prueba")).rejects.toThrow("fallo del proveedor");
  });

  it("no deja un temporizador vivo que retrase el proceso", async () => {
    const started = Date.now();
    await withTimeout(Promise.resolve(1), 60_000, "prueba");

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
