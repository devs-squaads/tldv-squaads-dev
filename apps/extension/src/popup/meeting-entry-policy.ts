import { TRACKABLE_STATUSES } from "../shared/constants";
import type { MeetingStatus } from "../shared/types";

export function getPopupMeetingEntryDecision(status: MeetingStatus) {
  const keepSubscription = TRACKABLE_STATUSES.includes(status);

  return {
    keepSubscription,
    allowInvite: !keepSubscription,
  };
}
