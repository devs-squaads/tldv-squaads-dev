export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  /** Etiqueta de hablante (nombre real, "Participante 1", "Hablante 1"…). Opcional. */
  speaker?: string;
}

export interface TranscriptionProviderResult {
  text: string;
  segments: TranscriptionSegment[];
  durationSeconds?: number;
}

export interface TranscriptionProviderOptions {
  context?: string;
  dictionaryTerms?: string[];
}

export interface TranscriptionProvider {
  readonly name: string;
  /**
   * Tamaño máximo de entrada que admite el proveedor, en bytes.
   *
   * Lo declara el propio proveedor para que el troceo se ajuste a él en vez de a un valor cableado:
   * cada API tiene su límite y no son intercambiables.
   */
  readonly maxInputBytes?: number;
  transcribe(filePath: string, options?: TranscriptionProviderOptions): Promise<string>;
  transcribeDetailed?(filePath: string, options?: TranscriptionProviderOptions): Promise<TranscriptionProviderResult>;
}
