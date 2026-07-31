/**
 * What `RESTORE_WIDGET` can actually do for the current tab.
 *
 * Restoring is not always a simple expand: `refreshForUrl` destroys the widget
 * instance whenever `isInsideActiveMeeting()` decides we left the meeting, so by
 * the time the user clicks "Restore Floating Widget" there is often no instance
 * left to expand — it has to be rebuilt, or the popup has to say so.
 */
export type RestorePlan =
  | { action: "expand" }
  | { action: "rebuild" }
  | { action: "reject"; reason: string };

export function planWidgetRestore(hasLiveWidget: boolean, hasMeeting: boolean): RestorePlan {
  if (hasLiveWidget) return { action: "expand" };
  if (hasMeeting) return { action: "rebuild" };
  return { action: "reject", reason: "No meeting detected in this tab." };
}
