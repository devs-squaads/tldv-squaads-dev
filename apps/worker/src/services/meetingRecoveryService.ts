import fs from "fs";
import os from "os";
import path from "path";
import { SummaryProviderFactory } from "@/integrations/ai/summary/SummaryProviderFactory";
import { StorageProviderFactory } from "@meeting-bot/shared/integrations/storage/StorageProviderFactory";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import {
  hasSummaryProvider,
  hasTranscriptionProvider,
  loadGlobalTranscriptionSettings,
  refineTranscriptionResult,
  resolveTranscriptionOptions,
  serializeTranscript,
  transcribeRecording,
  withSummaryDuration,
} from "@/services/meetingAiProcessingService";

export async function reprocessMeetingTranscription(meetingId: string): Promise<{ success: boolean; error?: string }> {
  const meeting = await MeetingRepository.findById(meetingId);
  if (!meeting) return { success: false, error: "Meeting not found" };
  if (!meeting.recordingFilePath) return { success: false, error: "No recording available to reprocess" };

  try {
    if (meeting.rawTranscription && !meeting.summary) {
      console.log(`[reprocess] Transcript exists, generating summary only for ${meetingId}...`);
      await MeetingRepository.updateById(meetingId, { status: "summarizing", updatedAt: new Date(), errorMessage: null });

      const settings = await loadGlobalTranscriptionSettings();
      const summaryProvider = SummaryProviderFactory.getProvider();
      const summaryContext = settings.context || undefined;
      const smartSummary = await summaryProvider.summarize(meeting.rawTranscription, { context: summaryContext });
      await MeetingRepository.updateById(meetingId, {
        status: "completed",
        summary: JSON.stringify(smartSummary),
        updatedAt: new Date(),
      });

      console.log(`[reprocess] Summary complete for ${meetingId}`);
      return { success: true };
    }

    if (!hasTranscriptionProvider()) {
      return { success: false, error: "No transcription provider configured" };
    }
    if (!hasSummaryProvider()) {
      return { success: false, error: "No summary provider configured" };
    }

    const storageKey = buildRecordingStorageKey(meetingId, meeting.url);
    const storage = StorageProviderFactory.getProvider();
    const tempPath = path.join(os.tmpdir(), `reprocess-${meetingId}.mp4`);

    try {
      console.log(`[reprocess] Downloading recording for meeting ${meetingId}...`);
      await storage.downloadFile(storageKey, tempPath);

      await MeetingRepository.updateById(meetingId, { status: "transcribing", updatedAt: new Date(), errorMessage: null });

      const settings = await loadGlobalTranscriptionSettings();
      const transcriptionOptions = await resolveTranscriptionOptions();
      const rawTranscription = await transcribeRecording(tempPath, transcriptionOptions);
      const transcription = await refineTranscriptionResult(rawTranscription, settings);
      const transcript = serializeTranscript(transcription.segments, transcription.text);
      console.log(`[reprocess] Transcription done for ${meetingId}`);

      await MeetingRepository.updateById(meetingId, { status: "summarizing", rawTranscription: transcript, updatedAt: new Date() });

      const summaryContext = settings.context || undefined;
      const summaryProvider = SummaryProviderFactory.getProvider();
      const smartSummary = withSummaryDuration(
        await summaryProvider.summarize(transcript, { context: summaryContext }),
        transcription,
      );
      await MeetingRepository.updateById(meetingId, {
        status: "completed",
        summary: JSON.stringify(smartSummary),
        updatedAt: new Date(),
      });

      console.log(`[reprocess] Reprocessing complete for ${meetingId}`);
      return { success: true };
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown reprocess error";
    console.error("[reprocess] Error:", error);
    await MeetingRepository.updateById(meetingId, { status: "error", errorMessage: message, updatedAt: new Date() });
    return { success: false, error: message };
  }
}

export async function retryRejectedMeeting(meetingId: string): Promise<{ success: boolean; error?: string }> {
  const meeting = await MeetingRepository.findById(meetingId);
  if (!meeting) return { success: false, error: "Meeting not found" };

  if (meeting.status !== "rejected" && meeting.status !== "error") {
    return { success: false, error: `Cannot retry meeting in status: ${meeting.status}` };
  }

  await MeetingRepository.updateById(meetingId, {
    status: "pending",
    errorMessage: null,
    updatedAt: new Date(),
  });

  console.log(`[retryRejected] Meeting ${meetingId} requeued as pending.`);
  return { success: true };
}

export async function refineMeetingSummary(
  meetingId: string,
  userPrompt: string,
): Promise<{ success: boolean; error?: string; summary?: unknown }> {
  try {
    const meeting = await MeetingRepository.findById(meetingId);
    if (!meeting) return { success: false, error: "Meeting not found" };
    if (!meeting.rawTranscription) return { success: false, error: "No transcription available" };

    await MeetingRepository.updateById(meetingId, { status: "summarizing", updatedAt: new Date() });

    const refinedPrompt = `${userPrompt}

Basándote en la transcripción de la reunión, genera el resultado.
Devuelve ÚNICAMENTE un JSON válido con este formato exacto, sin markdown ni texto adicional:
{
  "summary": "resumen según las instrucciones del usuario",
  "keyMoments": [
    {"timeSeconds": 0, "title": "Titulo corto", "description": "Descripción detallada del momento"}
  ],
  "actionItems": ["acción 1", "acción 2"]
}

IMPORTANTE: En keyMoments, cada momento debe tener timeSeconds (segundo exacto), title (máximo 6 palabras) y description.
Genera entre 4 y 15 capítulos temáticos en orden cronológico.

Transcripción:
${meeting.rawTranscription}`;

    const summaryProvider = SummaryProviderFactory.getProvider();
    const result = await summaryProvider.summarize(refinedPrompt);

    await MeetingRepository.updateById(meetingId, {
      status: "completed",
      summary: JSON.stringify(result),
      updatedAt: new Date(),
    });

    return { success: true, summary: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await MeetingRepository.updateById(meetingId, { status: "completed", updatedAt: new Date() });
    return { success: false, error: message };
  }
}
