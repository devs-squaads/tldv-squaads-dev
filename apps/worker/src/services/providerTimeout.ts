/**
 * Límite de tiempo para llamadas a proveedores externos (spec 017).
 *
 * Sin esto, un proveedor que acepta la petición y luego estanca la respuesta cuelga el pipeline de la
 * reunión de forma indefinida. Pasó de verdad: DeepSeek devolvió `200` con las cabeceras y dejó de
 * enviar el cuerpo, y la comprobación de salud se quedó colgada sin límite.
 *
 * No se puede confiar en el timeout del SDK: algunos no lo exponen. Envolver la promesa con
 * `Promise.race` acota la espera del pipeline aunque la petición siga viva por dentro.
 */

/** Por defecto 5 minutos: generoso para reemitir un transcript largo, pero acotado. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

export function resolveProviderTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.PROVIDER_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROVIDER_TIMEOUT_MS;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} superó el límite de ${Math.round(timeoutMs / 1000)} s`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
