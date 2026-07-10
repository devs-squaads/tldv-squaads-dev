import { DeleteMeetingCommand, type DeleteMeetingResult } from "@/commands/meeting/DeleteMeetingCommand";
import { EnqueueMeetingCommand, type EnqueueMeetingInput } from "@/commands/meeting/EnqueueMeetingCommand";

export class MeetingService {
  static async enqueueMeeting(input: EnqueueMeetingInput): Promise<{ id: string }> {
    return new EnqueueMeetingCommand(input).execute();
  }

  static async deleteMeeting(meetingId: string): Promise<DeleteMeetingResult> {
    return new DeleteMeetingCommand(meetingId).execute();
  }
}
