import { queueMeetingRun } from "@meeting-bot/shared/services/meetingQueueService";
import type { MeetingCommand } from "./MeetingCommand";

export interface EnqueueMeetingInput {
  meetingUrl: string;
  botName: string;
  duration: number;
  ownerId: string;
  provider?: string;
}

export class EnqueueMeetingCommand implements MeetingCommand<{ id: string }> {
  constructor(private readonly input: EnqueueMeetingInput) {}

  async execute(): Promise<{ id: string }> {
    return queueMeetingRun({
      meetingUrl: this.input.meetingUrl,
      botName: this.input.botName,
      duration: this.input.duration,
      ownerId: this.input.ownerId,
      providerHint: this.input.provider,
    });
  }
}
