import fs from "fs";
import os from "os";
import path from "path";
import { startBot } from "@/bot/index";
import { ADMISSION_TIMEOUT_ERROR_TAG } from "@/bot/providers/OnlineMeetingProvider";
import { canTransitionStatus, type MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";
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
import { SummaryProviderFactory } from "@/integrations/ai/summary/SummaryProviderFactory";
import { WorkerMeetingRepository } from "@/repositories/WorkerMeetingRepository";

function isAdmissionRejection(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("denied bot entry") ||
      error.message.includes("denegado") ||
      (error.name === "AdmissionError" && error.message.includes("denied"));
  }
  return false;
}

async function processMeetingAsync({
  meetingId,
  meetingUrl,
  botName,
  duration,
  outputPath,
}: {
  meetingId: string;
  meetingUrl: string;
  botName: string;
  duration: number;
  outputPath: string;
}): Promise<{ success: boolean; retryable: boolean }> {
  try {
    const meetingBeforeRun = await MeetingRepository.findById(meetingId);
    const currentStatus = meetingBeforeRun?.status as MeetingStatus | undefined;
    if (currentStatus && canTransitionStatus(currentStatus, "joining")) {
      await MeetingRepository.updateById(meetingId, {
        status: "joining",
        updatedAt: new Date(),
        errorMessage: null,
      });
    }

    const result = await startBot({
      meetingUrl,
      botName,
      duration,
      outputPath,
      onPhaseChange: async (phase) => {
        const before = await MeetingRepository.findById(meetingId);
        const from = before?.status as MeetingStatus | undefined;
        if (!from || !canTransitionStatus(from, phase)) return;
        await MeetingRepository.updateById(meetingId, {
          status: phase,
          updatedAt: new Date(),
        });
      },
    });

    const now = new Date();
    if (!result.success) {
      const errorMsg = result.error || "Bot failed";

      if (errorMsg.includes("denied bot entry") || errorMsg.includes("denegado")) {
        await MeetingRepository.updateById(meetingId, {
          status: "rejected",
          errorMessage: "El organizador rechazó la entrada del bot.",
          updatedAt: now,
          endsAt: now,
        });
        return { success: false, retryable: false };
      }

      if (errorMsg.includes(ADMISSION_TIMEOUT_ERROR_TAG)) {
        await MeetingRepository.updateById(meetingId, {
          status: "admission_timeout",
          errorMessage: "Tiempo de espera agotado en sala de espera.",
          updatedAt: now,
          endsAt: now,
        });
        return { success: false, retryable: true };
      }

      await MeetingRepository.updateById(meetingId, {
        status: "error",
        errorMessage: errorMsg,
        updatedAt: now,
        endsAt: now,
      });
      return { success: false, retryable: true };
    }

    const storageKey = buildRecordingStorageKey(meetingId, meetingUrl, result.provider);
    const storage = StorageProviderFactory.getProvider();
    const uploadResult = await storage.uploadFile(outputPath, storageKey, "video/mp4");

    if (!hasTranscriptionProvider()) {
      await MeetingRepository.updateById(meetingId, {
        recordingFilePath: uploadResult.url,
        status: "completed",
        updatedAt: new Date(),
        endsAt: now,
      });
      return { success: true, retryable: true };
    }

    await MeetingRepository.updateById(meetingId, {
      status: "transcribing",
      recordingFilePath: uploadResult.url,
      updatedAt: new Date(),
      endsAt: now,
    });

    // The recording is already uploaded: AI failures below must never restart
    // the capture pipeline (rejoining the meeting), so they are non-retryable.
    try {
      const settings = await loadGlobalTranscriptionSettings();
      const transcriptionOptions = await resolveTranscriptionOptions();
      const rawTranscription = await transcribeRecording(outputPath, transcriptionOptions);

      const transcription = await refineTranscriptionResult(rawTranscription, settings);
      const transcript = serializeTranscript(transcription.segments, transcription.text);

      if (!hasSummaryProvider()) {
        await MeetingRepository.updateById(meetingId, {
          rawTranscription: transcript,
          status: "completed",
          updatedAt: new Date(),
        });
        return { success: true, retryable: true };
      }

      const summaryContext = settings.context || undefined;
      const summaryProvider = SummaryProviderFactory.getProvider();
      await MeetingRepository.updateById(meetingId, {
        status: "summarizing",
        rawTranscription: transcript,
        updatedAt: new Date(),
      });

      const smartSummary = withSummaryDuration(
        await summaryProvider.summarize(transcript, { context: summaryContext }),
        transcription,
      );
      await MeetingRepository.updateById(meetingId, {
        status: "completed",
        summary: JSON.stringify(smartSummary),
        updatedAt: new Date(),
      });
      return { success: true, retryable: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown AI processing error";
      await MeetingRepository.updateById(meetingId, {
        status: "error",
        errorMessage: `La grabación se guardó, pero falló el procesamiento de IA: ${message}`,
        updatedAt: new Date(),
      });
      return { success: false, retryable: false };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown processing error";

    if (isAdmissionRejection(error)) {
      await MeetingRepository.updateById(meetingId, {
        status: "rejected",
        errorMessage: "El organizador rechazó la entrada del bot.",
        updatedAt: new Date(),
        endsAt: new Date(),
      });
      return { success: false, retryable: false };
    }

    await MeetingRepository.updateById(meetingId, {
      status: "error",
      errorMessage: message,
      updatedAt: new Date(),
      endsAt: new Date(),
    });
    return { success: false, retryable: true };
  } finally {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
}

export async function claimNextMeeting() {
  return WorkerMeetingRepository.claimNextPending();
}

export async function processClaimedMeeting(claimed: {
  id: string;
  url: string;
  botName: string | null;
  durationMinutes: number | null;
}): Promise<{ processed: boolean; meetingId: string }> {
  const botName = claimed.botName || process.env.BOT_DEFAULT_NAME || "Squaads Assistant";
  const duration = claimed.durationMinutes || Number(process.env.BOT_DEFAULT_DURATION_MINUTES || 60);
  const maxAttempts = Number(process.env.WORKER_MAX_ATTEMPTS || 3);
  const baseBackoffMs = Number(process.env.WORKER_RETRY_BASE_MS || 2000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[worker] Processing meeting ${claimed.id} (attempt ${attempt}/${maxAttempts})`);
    const outputPath = path.join(os.tmpdir(), `meeting-${claimed.id}.mp4`);
    const result = await processMeetingAsync({
      meetingId: claimed.id,
      meetingUrl: claimed.url,
      botName,
      duration,
      outputPath,
    });

    if (result.success) {
      console.log(`[worker] Meeting ${claimed.id} completed successfully.`);
      return { processed: true, meetingId: claimed.id };
    }

    const currentMeeting = await MeetingRepository.findById(claimed.id);
    if (currentMeeting?.status === "rejected") {
      console.log(`[worker] Meeting ${claimed.id} in terminal state (${currentMeeting.status}). Not retrying.`);
      return { processed: true, meetingId: claimed.id };
    }

    if (!result.retryable) {
      console.log(`[worker] Meeting ${claimed.id} failed with non-retryable error.`);
      return { processed: true, meetingId: claimed.id };
    }

    if (attempt < maxAttempts) {
      const waitMs = baseBackoffMs * 2 ** (attempt - 1);
      console.warn(`[worker] Meeting ${claimed.id} failed. Retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
      await MeetingRepository.updateById(claimed.id, {
        status: "pending",
        updatedAt: new Date(),
        errorMessage: `Reintento programado (${attempt}/${maxAttempts}) tras fallo.`,
      });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  const finalMeeting = await MeetingRepository.findById(claimed.id);
  const finalStatus = finalMeeting?.status || "error";
  console.error(`[worker] Meeting ${claimed.id} exhausted retries and remains in ${finalStatus} state.`);
  return { processed: true, meetingId: claimed.id };
}
