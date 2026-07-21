import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { StorageProviderFactory } from "@meeting-bot/shared/integrations/storage/StorageProviderFactory";
import { WebMeetingRepository } from "@/repositories/WebMeetingRepository";
import type { MeetingCommand } from "./MeetingCommand";

export interface DeleteMeetingResult {
  success: boolean;
  error?: string;
}

export class DeleteMeetingCommand implements MeetingCommand<DeleteMeetingResult> {
  constructor(private readonly meetingId: string) {}

  async execute(): Promise<DeleteMeetingResult> {
    const meeting = await MeetingRepository.findById(this.meetingId);

    if (!meeting) {
      return { success: false, error: "Meeting not found" };
    }

    if (meeting.recordingFilePath) {
      try {
        const storageKey = meeting.recordingStorageKey ?? buildRecordingStorageKey(this.meetingId, meeting.url);
        const storage = StorageProviderFactory.getProvider();
        await storage.deleteFile(storageKey);
      } catch (storageErr: unknown) {
        const message = storageErr instanceof Error ? storageErr.message : "Unknown storage error";
        console.warn("[DeleteMeetingCommand] Storage deletion warning:", message);
      }
    }

    await WebMeetingRepository.deleteById(this.meetingId);
    return { success: true };
  }
}
