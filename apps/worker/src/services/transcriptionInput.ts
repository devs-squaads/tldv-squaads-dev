/**
 * Planificación pura de la entrada de transcripción (spec 016).
 *
 * El worker enviaba el fichero de vídeo entero a la API de ASR: la grabación de 53,5 min pesaba
 * 375 MB y Groq respondió `413 request_too_large`. Este módulo decide, sin tocar disco ni red,
 * si el audio extraído cabe en el límite del proveedor y cómo trocearlo cuando no cabe.
 */

/** Límite de subida del proveedor de ASR (Groq: 25 MB). */
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Duración de cada fragmento cuando hay que trocear. */
export const DEFAULT_CHUNK_SECONDS = 900;
/** Solapamiento entre fragmentos, para no cortar una palabra a la mitad. */
export const DEFAULT_OVERLAP_SECONDS = 5;

export interface AudioChunk {
  index: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface TranscriptionInputPlan {
  /** true cuando hay que partir el audio en varios ficheros. */
  needsChunking: boolean;
  /** Fragmentos a transcribir; uno solo que cubre todo el audio cuando no hace falta trocear. */
  chunks: AudioChunk[];
  /** El audio extraído sigue por encima del límite: trocear es la única salida. */
  oversizeAfterExtraction: boolean;
}

export interface PlanInput {
  audioBytes: number;
  durationSeconds: number;
  maxBytes?: number;
  chunkSeconds?: number;
  overlapSeconds?: number;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function planTranscriptionInput(input: PlanInput): TranscriptionInputPlan {
  const maxBytes = positiveOr(input.maxBytes, DEFAULT_MAX_UPLOAD_BYTES);
  const durationSeconds = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
    ? input.durationSeconds
    : 0;

  const fitsInOneUpload = input.audioBytes <= maxBytes;

  if (fitsInOneUpload) {
    return {
      needsChunking: false,
      chunks: [{ index: 0, startSeconds: 0, durationSeconds }],
      oversizeAfterExtraction: false,
    };
  }

  const chunkSeconds = positiveOr(input.chunkSeconds, DEFAULT_CHUNK_SECONDS);
  const rawOverlap = positiveOr(input.overlapSeconds, DEFAULT_OVERLAP_SECONDS);
  // Un solapamiento mayor o igual que el fragmento dejaría el paso en cero y el bucle no avanzaría.
  const overlapSeconds = rawOverlap < chunkSeconds ? rawOverlap : 0;
  const stepSeconds = chunkSeconds - overlapSeconds;

  const chunks: AudioChunk[] = [];
  let startSeconds = 0;
  let index = 0;

  while (startSeconds < durationSeconds) {
    chunks.push({
      index,
      startSeconds,
      durationSeconds: Math.min(chunkSeconds, durationSeconds - startSeconds),
    });
    index += 1;
    startSeconds = index * stepSeconds;
  }

  // Duración desconocida (0): un único fragmento, que es lo mejor que se puede decidir sin medir.
  if (chunks.length === 0) {
    chunks.push({ index: 0, startSeconds: 0, durationSeconds: 0 });
  }

  return { needsChunking: chunks.length > 1, chunks, oversizeAfterExtraction: true };
}

export interface AbsoluteSegment {
  start: number;
  end: number;
}

/**
 * Fusiona los resultados de varios fragmentos en una línea temporal absoluta.
 *
 * Cada fragmento se transcribió empezando en cero, así que sus marcas se desplazan por el inicio del
 * fragmento.
 *
 * Deduplicación: se descarta un segmento **sólo si está completamente cubierto** por fragmentos
 * anteriores. Un segmento que empieza dentro del solape pero se prolonga más allá se conserva entero,
 * aunque eso duplique unas palabras en la costura: perder contenido es peor que repetirlo, y no hay
 * forma fiable de separar por tiempo el texto repetido del nuevo. Los solapes *dentro* de un mismo
 * fragmento no se tocan nunca.
 */
export function mergeChunkSegments<T extends AbsoluteSegment>(
  chunks: ReadonlyArray<Pick<AudioChunk, "startSeconds">>,
  results: ReadonlyArray<ReadonlyArray<T>>,
): Array<Omit<T, "start" | "end"> & AbsoluteSegment> {
  const merged: Array<Omit<T, "start" | "end"> & AbsoluteSegment> = [];
  /** Hasta dónde llega lo cubierto por fragmentos ANTERIORES. */
  let coveredByEarlierChunks = Number.NEGATIVE_INFINITY;
  let highestEndSoFar = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < chunks.length; i += 1) {
    const offset = chunks[i].startSeconds;

    for (const segment of results[i] ?? []) {
      const absoluteStart = segment.start + offset;
      const absoluteEnd = segment.end + offset;

      if (absoluteEnd <= coveredByEarlierChunks) {
        continue; // redundante: ya estaba cubierto entero por un fragmento anterior
      }

      merged.push({ ...segment, start: absoluteStart, end: absoluteEnd });
      highestEndSoFar = Math.max(highestEndSoFar, absoluteEnd);
    }

    // Al cerrar el fragmento, su cobertura pasa a ser la referencia para el siguiente.
    coveredByEarlierChunks = highestEndSoFar;
  }

  return merged;
}
