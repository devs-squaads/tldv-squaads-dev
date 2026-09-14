/**
 * Reglas puras de autorización para las rutas de API de la web (spec 015).
 *
 * Vive separado de las rutas por el mismo motivo que `lib/pageAuthGuard.ts`: son decisiones
 * booleanas sin dependencias de Next.js, así que se testean sin montar un ciclo
 * request/response. Las rutas sólo aplican el resultado.
 */

/**
 * Claves de la tabla `settings` que la UI puede escribir a través del endpoint genérico
 * `POST /api/settings`. Deliberadamente mínima: la tabla aloja también
 * `transcription_context` y `transcription_dictionary`, que se inyectan en el prompt de ASR
 * y del refiner, así que una escritura arbitraria equivale a una inyección de prompt
 * persistente sobre todas las reuniones. El contexto IA tiene su propia ruta.
 */
export const EDITABLE_SETTING_KEYS: ReadonlyArray<string> = ["monitor_email"];

/** ¿Es `key` una clave que la UI puede escribir por el endpoint genérico? */
export function isEditableSettingKey(key: string): boolean {
  return EDITABLE_SETTING_KEYS.includes(key);
}

/**
 * Filtra un cuerpo de petición dejando sólo las claves editables.
 * Devuelve `{ accepted, rejected }` para que la ruta pueda rechazar explícitamente
 * (400) en vez de descartar en silencio.
 */
export function partitionSettingWrites(data: Record<string, unknown>): {
  accepted: Record<string, unknown>;
  rejected: string[];
} {
  const accepted: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (isEditableSettingKey(key)) {
      accepted[key] = value;
    } else {
      rejected.push(key);
    }
  }

  return { accepted, rejected };
}
