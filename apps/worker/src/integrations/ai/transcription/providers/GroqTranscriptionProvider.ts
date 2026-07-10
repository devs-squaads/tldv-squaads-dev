import type {
  TranscriptionProvider,
  TranscriptionProviderOptions,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import { transcribeAudio, transcribeAudioWithTimestamps } from "@/services/groq";

export class GroqTranscriptionProvider implements TranscriptionProvider {
  readonly name = "groq";

  async transcribe(filePath: string, options?: TranscriptionProviderOptions): Promise<string> {
    return transcribeAudio(filePath, options);
  }

  async transcribeDetailed(filePath: string, options?: TranscriptionProviderOptions) {
    const result = await transcribeAudioWithTimestamps(filePath, options);
    return {
      text: result.text,
      segments: result.segments,
      durationSeconds: result.duration,
    };
  }
}
