export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
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
