import { pickAdapter } from "./adapters";
import { MeetingWidget } from "./widget";
import { logInfo } from "../shared/logger";
import type { RuntimeMessage, RuntimeResponse } from "../shared/types";

let widget: MeetingWidget | null = null;
let lastUrl = "";
let lastMeetingKey = "";

async function refreshForUrl(url: string) {
  const adapter = pickAdapter(url);
  if (!adapter) {
    lastUrl = url;
    lastMeetingKey = "";
    widget?.destroy();
    widget = null;
    return;
  }

  const meetingUrl = adapter.getMeetingUrl(url);
  if (!meetingUrl || !adapter.isInsideActiveMeeting()) {
    lastUrl = url;
    lastMeetingKey = "";
    widget?.destroy();
    widget = null;
    return;
  }

  const key = `${adapter.provider}:${meetingUrl}`;
  const sameMeeting = widget && key === lastMeetingKey;
  if (sameMeeting) {
    lastUrl = url;
    widget.sync();
    return;
  }

  if (widget) {
    widget.destroy();
    widget = null;
  }

  widget = new MeetingWidget(meetingUrl, adapter.provider);
  lastUrl = url;
  lastMeetingKey = key;
  logInfo("widget mounted", { provider: adapter.provider, meetingUrl });
  await widget.bootstrap();
}

function start() {
  void refreshForUrl(window.location.href);
  setInterval(() => {
    void refreshForUrl(window.location.href);
  }, 1500);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "RESTORE_WIDGET") {
    widget?.restore();
    sendResponse({ ok: true } satisfies RuntimeResponse);
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
