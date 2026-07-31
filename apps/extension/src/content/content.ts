import { pickAdapter } from "./adapters";
import type { MeetingPageAdapter } from "./adapters/types";
import { planWidgetRestore } from "./restore-policy";
import { MeetingWidget } from "./widget";
import { logInfo } from "../shared/logger";
import type { RuntimeMessage, RuntimeResponse } from "../shared/types";

interface DetectedMeeting {
  adapter: MeetingPageAdapter;
  meetingUrl: string;
  key: string;
}

let widget: MeetingWidget | null = null;
let lastMeetingKey = "";
/**
 * Meeting the user explicitly restored from the popup. While it is pinned, the
 * `isInsideActiveMeeting()` text heuristic may not tear the widget down again —
 * that heuristic is what removed it before the user asked for it back, so
 * honouring it here would undo the restore on the next 1.5s tick.
 */
let pinnedMeetingKey = "";

function detectMeeting(url: string): DetectedMeeting | null {
  const adapter = pickAdapter(url);
  const meetingUrl = adapter?.getMeetingUrl(url);
  if (!adapter || !meetingUrl) return null;
  return { adapter, meetingUrl, key: `${adapter.provider}:${meetingUrl}` };
}

function teardown() {
  lastMeetingKey = "";
  pinnedMeetingKey = "";
  widget?.destroy();
  widget = null;
}

function mount(meeting: DetectedMeeting): MeetingWidget {
  widget?.destroy();
  widget = new MeetingWidget(meeting.meetingUrl, meeting.adapter.provider);
  lastMeetingKey = meeting.key;
  return widget;
}

async function refreshForUrl(url: string) {
  const meeting = detectMeeting(url);
  if (!meeting) {
    teardown();
    return;
  }

  if (!meeting.adapter.isInsideActiveMeeting() && pinnedMeetingKey !== meeting.key) {
    teardown();
    return;
  }

  if (widget && meeting.key === lastMeetingKey) {
    widget.sync();
    return;
  }

  const mounted = mount(meeting);
  logInfo("widget mounted", { provider: meeting.adapter.provider, meetingUrl: meeting.meetingUrl });
  await mounted.bootstrap();
}

async function restoreWidget(): Promise<RuntimeResponse> {
  const meeting = detectMeeting(window.location.href);
  const plan = planWidgetRestore(Boolean(widget), meeting !== null);

  if (plan.action === "expand") {
    widget?.restore();
    return { ok: true };
  }

  if (plan.action === "reject") {
    return { ok: false, error: plan.reason };
  }

  // `rebuild` is only planned when a meeting was detected.
  if (!meeting) return { ok: false, error: "No meeting detected in this tab." };

  const mounted = mount(meeting);
  pinnedMeetingKey = meeting.key;
  logInfo("widget rebuilt from popup", {
    provider: meeting.adapter.provider,
    meetingUrl: meeting.meetingUrl,
  });
  await mounted.bootstrap();
  return { ok: true };
}

function start() {
  void refreshForUrl(window.location.href);
  setInterval(() => {
    void refreshForUrl(window.location.href);
  }, 1500);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "RESTORE_WIDGET") {
    // Rebuilding mounts a widget and awaits its bootstrap, so the reply is async;
    // returning true keeps the message channel open until it resolves.
    void restoreWidget().then(sendResponse);
    return true;
  }

  if (message.type === "GET_WIDGET_STATE") {
    sendResponse({ ok: true, data: widget ? widget.getViewState() : { collapsed: true } } satisfies RuntimeResponse);
    return true;
  }

  return false;
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
