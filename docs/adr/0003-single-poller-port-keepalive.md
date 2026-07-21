# Single Poller with Port-as-Keepalive for Extension Status Sync

In MV3, the service worker (SW) is the single poller for meeting status. It stays alive via a long-lived
`chrome.runtime.connect` Port opened by the content script while a meeting tab is open; this Port is also
the subscription channel (carries `MEETING_UPDATE` broadcasts) and the subscriber counter (`onDisconnect`
signals a lost subscriber). `chrome.alarms` at 30s (Chrome 120+ minimum) is a degraded fallback only — not
the tick base, since it cannot achieve the 2s adaptive interval required for transient phases.

## Status

accepted

## Considered Options

- **SSE/WebSockets from backend**: rejected — out of scope for 007; the pain is client-side coordination
  (dual polling, render churn), not transport. SSE remains a backlog evolution.
- **`chrome.alarms` as tick base**: rejected — minimum period is 30s (Chrome 120+), which breaks the ≤3s
  acceptance criterion. Usable only as a degraded wake-up when no Port is active.
- **Content script hosts the loop**: rejected — background-tab throttling degrades timers to ~1/min after
  5 min, causing the exact symptom we're fixing (stale status while bot is recording).
- **Popup opens its own keepalive Port**: accepted as part of the design — the popup opens a Port to
  receive broadcasts; it incidentally helps keepalive but its primary purpose is subscription, not
  keepalive.

## Consequences

- The SW maintains a `meetingId → { ports: Set<Port>, loop }` registry. Multiple meetings are supported
  simultaneously.
- When the last Port for a meeting disconnects, the SW stops that meeting's loop to avoid polling for
  nobody.
- The SW's in-memory cache is not persistent across suspension. On wake, a late subscriber triggers a
  synchronous fetch before receiving a snapshot — never a stale value presented as current.
- Peak latency during a hung request is `REQUEST_TIMEOUT_MS` (10s). This is inherent to polling and has no
  mitigation within 007's scope; SSE would resolve it but is deferred.
