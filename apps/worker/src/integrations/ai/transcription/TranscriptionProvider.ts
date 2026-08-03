export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  /** Etiqueta de hablante (ej. "Participante 1", nombre inferido por LLM). Opcional. */
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
  transcribe(filePath: string, options?: TranscriptionProviderOptions): Promise<string>;
  transcribeDetailed?(filePath: string, options?: TranscriptionProviderOptions): Promise<TranscriptionProviderResult>;
}
