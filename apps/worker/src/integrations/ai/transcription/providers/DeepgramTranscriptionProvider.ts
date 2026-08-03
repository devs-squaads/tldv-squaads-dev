import type {
  TranscriptionProvider,
  TranscriptionProviderOptions,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import { transcribeAudio, transcribeDetailed } from "@/services/deepgram";

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  readonly name = "deepgram";

  async transcribe(filePath: string, options?: TranscriptionProviderOptions): Promise<string> {
    const result = await transcribeAudio(filePath, options);
    return result;
  }

  async transcribeDetailed(filePath: string, options?: TranscriptionProviderOptions) {
    const result = await transcribeDetailed(filePath, options);
    return {
      text: result.text,
      segments: result.segments,
      durationSeconds: result.duration,
    };
  }
}
