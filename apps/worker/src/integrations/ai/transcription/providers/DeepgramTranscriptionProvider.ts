import type {
  TranscriptionProvider,
  TranscriptionProviderOptions,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import { transcribeAudio } from "@/services/deepgram";

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  readonly name = "deepgram";

  async transcribe(filePath: string, options?: TranscriptionProviderOptions): Promise<string> {
    return transcribeAudio(filePath, options);
  }
}
