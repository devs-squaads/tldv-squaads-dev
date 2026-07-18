import {
  ACTIVE_STATUSES,
  RETRYABLE_TERMINAL_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../shared/constants";
import { diff, type WidgetRenderState } from "../shared/status-sync";
import { getWidgetPosition, saveWidgetPosition } from "../shared/storage";
import type {
  MeetingProvider,
  MeetingStatus,
  PortMessage,
  RuntimeMessage,
  RuntimeResponse,
  StatusResponse,
  WidgetPosition,
} from "../shared/types";

type WidgetState =
  | { type: "checking" }
  | { type: "not_configured" }
  | { type: "idle" }
  | { type: "inviting" }
  | { type: "active"; meetingId: string; status: MeetingStatus }
  | { type: "error"; message: string };

function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message);
}

/** Minimal Chrome runtime.Port shape for the subscription channel. */
interface WidgetPort {
  onMessage: { addListener: (cb: (msg: PortMessage) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  postMessage: (msg: PortMessage) => void;
  disconnect: () => void;
}

/** Port channel name — must match the service worker's STATUS_PORT_NAME. */
const STATUS_PORT_NAME = "squaads-status";

/** Reconnection backoff (ms): 0 (immediate), 1s, 2s, 4s (capped). */
export function reconnectBackoff(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(1000 * 2 ** (attempts - 1), 4000);
}

export class MeetingWidget {
  private readonly host: HTMLDivElement;
  private readonly meetingUrl: string;
  private readonly provider: MeetingProvider;
  private state: WidgetState = { type: "checking" };
  private statusRequestInFlight = false;
  private collapsed = false;
  private destroyed = false;
  private dragging = false;
  private hovered = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private position: WidgetPosition | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private readonly boundPointerMove: (event: PointerEvent) => void;
  private readonly boundPointerUp: () => void;
  private port: WidgetPort | null = null;
  private subscribedMeetingId: string | null = null;
  private expectedDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(meetingUrl: string, provider: MeetingProvider) {
    this.meetingUrl = meetingUrl;
    this.provider = provider;
    this.host = document.createElement("div");
    this.host.id = "squaads-widget-root";
    this.host.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:system-ui,sans-serif;transition:opacity .18s ease, transform .18s ease;opacity:.72;";
    document.body.appendChild(this.host);
    this.boundPointerMove = (event) => this.onPointerMove(event);
    this.boundPointerUp = () => this.onPointerUp();
    this.openPort();
    this.host.addEventListener("mouseenter", () => {
      this.hovered = true;
      this.syncVisualState();
    });
    this.host.addEventListener("mouseleave", () => {
      this.hovered = false;
      this.scheduleIdleVisuals();
    });
    void this.restorePosition();
    this.scheduleIdleVisuals();
    this.mount();
  }

  /** Opens the long-lived Port to the SW (subscription + keepalive). */
  private openPort() {
    this.port = chrome.runtime.connect({ name: STATUS_PORT_NAME }) as WidgetPort;
    this.port.onMessage.addListener((msg: PortMessage) => {
      if (msg.type !== "MEETING_UPDATE") return;
      if (msg.meetingId !== this.subscribedMeetingId) return;
      this.applyPortUpdate(msg.status);
    });
    // HELLO clears the SW handshake timeout immediately — before SUBSCRIBE
    // (which may arrive late, after checkStatus() resolves).
    this.port.postMessage({ type: "HELLO" });
    // Expected disconnect (destroy/terminal): keep the last status shown.
    // Unexpected disconnect (SW death, handshake timeout, Chrome kill):
    // reset subscription state and attempt reconnection with backoff.
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      if (this.expectedDisconnect) return;
      this.subscribedMeetingId = null;
      this.reopenPort();
    });
  }

  /**
   * Reopens the Port after an unexpected disconnect. Sends HELLO, then if the
   * widget is still showing an active meeting, re-subscribes to it. Uses
   * exponential backoff (0, 1s, 2s, 4s cap) across successive failures.
   */
  private reopenPort() {
    if (this.isInactive()) return;
    const delay = reconnectBackoff(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      if (this.isInactive()) return;
      this.openPort();
      if (this.state.type === "active" && this.state.meetingId) {
        this.subscribe(this.state.meetingId);
      }
    }, delay);
  }

  /** Sends SUBSCRIBE for a meeting — the only entry point to the SW loop. */
  private subscribe(meetingId: string) {
    if (this.isInactive()) return;
    if (this.subscribedMeetingId === meetingId && this.port) return;
    this.subscribedMeetingId = meetingId;
    this.reconnectAttempts = 0;
    this.port?.postMessage({ type: "SUBSCRIBE", meetingId, provider: this.provider });
  }

  async bootstrap(): Promise<void> {
    await this.checkStatus();
  }

  /**
   * Called by the content script on URL re-detection. The SW pushes updates via
   * Port, so this is now a no-op — kept for content-script compatibility.
   */
  sync() {
    // No-op — the Single Poller (SW) pushes status updates via Port.
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.expectedDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.port?.disconnect();
    this.port = null;
    this.clearIdleTimer();
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
    this.host.remove();
    void send({ type: "SET_BADGE", state: "clear" });
  }

  restore() {
    if (this.isInactive()) return;
    this.expand();
    this.bringToFront();
  }

  getViewState() {
    return { collapsed: this.collapsed };
  }

  private setState(next: WidgetState) {
    if (this.isInactive()) return;
    const prevRender = this.toRenderState(this.state);
    const nextRender = this.toRenderState(next);
    this.state = next;
    this.syncBadge();
    const patch = diff(prevRender, nextRender);
    switch (patch.attribute) {
      case "none":
        return;
      case "full":
        this.mount();
        return;
      case "status":
        this.patchStatus(patch.value);
    }
  }

  private toRenderState(state: WidgetState): WidgetRenderState {
    if (state.type === "active") {
      return { type: "active", status: state.status };
    }
    return { type: state.type, status: null };
  }

  /**
   * Surgical status patch — updates indicator color, message text and action
   * button WITHOUT rebuilding the DOM. Preserves the dragged node and any
   * in-progress pointer interaction.
   */
  private patchStatus(status: MeetingStatus) {
    if (this.isInactive()) return;
    const color = STATUS_COLORS[status];
    const label = STATUS_LABELS[status];

    this.host.querySelectorAll<HTMLElement>("[data-squaads-indicator]").forEach((el) => {
      el.style.background = color;
      el.style.boxShadow = `0 0 16px ${color}`;
    });

    this.host.querySelectorAll<HTMLElement>("[data-squaads-message]").forEach((el) => {
      el.textContent = label;
    });

    const action = this.host.querySelector<HTMLElement>("#squaads-primary-btn");
    if (action) {
      action.textContent = label;
      action.style.background = color;
    }
  }

  private isInactive() {
    return this.destroyed;
  }

  /**
   * Handles a status update received via the Port (SW broadcast).
   * - Active/completed: update the active state with the new status.
   * - Retryable terminal (admission_timeout/rejected/error): show error state.
   */
  private applyPortUpdate(status: MeetingStatus) {
    if (this.isInactive()) return;
    if (RETRYABLE_TERMINAL_STATUSES.includes(status)) {
      this.setState({ type: "error", message: STATUS_LABELS[status] });
      return;
    }
    this.setState({
      type: "active",
      meetingId: this.subscribedMeetingId ?? "",
      status,
    });
  }

  private syncBadge() {
    if (this.state.type === "active" && this.state.status === "recording") {
      void send({ type: "SET_BADGE", state: "recording" });
      return;
    }
    if (this.state.type === "error") {
      void send({ type: "SET_BADGE", state: "error" });
      return;
    }
    void send({ type: "SET_BADGE", state: "clear" });
  }

  private scheduleIdleVisuals() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.syncVisualState();
    }, 900);
  }

  private clearIdleTimer() {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private syncVisualState() {
    if (this.isInactive()) return;
    const active = this.dragging || this.hovered;
    this.host.style.opacity = active ? "1" : "0.72";
    this.host.style.transform = active ? "translateY(0)" : "translateY(2px)";
  }

  private bringToFront() {
    this.hovered = true;
    this.syncVisualState();
    this.scheduleIdleVisuals();
  }

  private async restorePosition() {
    const saved = await getWidgetPosition();
    if (!saved || this.isInactive()) return;
    this.position = this.clampPosition(saved);
    this.applyPosition();
  }

  private clampPosition(position: WidgetPosition): WidgetPosition {
    const margin = 12;
    const width = this.host.offsetWidth || (this.collapsed ? 260 : 360);
    const height = this.host.offsetHeight || 56;
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);

    return {
      x: Math.min(Math.max(position.x, margin), maxX),
      y: Math.min(Math.max(position.y, margin), maxY),
    };
  }

  private applyPosition() {
    if (!this.position) {
      this.host.style.left = "";
      this.host.style.top = "";
      this.host.style.right = "20px";
      this.host.style.bottom = "20px";
      return;
    }

    this.host.style.left = `${this.position.x}px`;
    this.host.style.top = `${this.position.y}px`;
    this.host.style.right = "auto";
    this.host.style.bottom = "auto";
  }

  private beginDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const isCollapsedButton = Boolean(target?.closest("#squaads-expand-btn"));
    if (target?.closest("button") && !target.closest("#squaads-drag-handle") && !isCollapsedButton) {
      return;
    }

    const rect = this.host.getBoundingClientRect();
    this.position = { x: rect.left, y: rect.top };
    this.applyPosition();
    this.dragging = true;
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
    this.host.style.cursor = "grabbing";
    this.host.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", this.boundPointerMove);
    window.addEventListener("pointerup", this.boundPointerUp);
    this.syncVisualState();
  }

  private onPointerMove(event: PointerEvent) {
    if (!this.dragging) return;
    const next = this.clampPosition({
      x: event.clientX - this.dragOffsetX,
      y: event.clientY - this.dragOffsetY,
    });
    this.position = next;
    this.applyPosition();
  }

  private onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.host.style.cursor = "default";
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
    if (this.position) {
      void saveWidgetPosition(this.position);
    }
    this.scheduleIdleVisuals();
  }

  private mount() {
    const wrap =
      "display:flex;gap:10px;align-items:center;padding:12px 13px;border-radius:22px;min-width:280px;max-width:390px;position:relative;overflow:hidden;backdrop-filter:blur(18px);";
    const card =
      "background:linear-gradient(145deg, rgba(8,15,29,.94), rgba(12,25,44,.88));color:#f8fafc;border:1px solid rgba(148,163,184,.18);box-shadow:0 24px 60px rgba(2,8,23,.45), inset 0 1px 0 rgba(255,255,255,.05)";
    const content = "display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;position:relative;z-index:1;";
    const statusLabel = "font-size:12px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;";
    const metaLabel = "opacity:.72;text-transform:uppercase;font-size:10px;letter-spacing:.14em;color:#8da2be;";
    const button =
      "border:1px solid transparent;border-radius:999px;padding:9px 13px;min-width:120px;cursor:pointer;font-weight:800;font-size:12px;letter-spacing:.01em;position:relative;z-index:1;box-shadow:0 12px 28px rgba(14,165,233,.22);";
    const dismissButton =
      "border:1px solid rgba(148,163,184,.12);border-radius:999px;width:24px;height:24px;background:rgba(15,23,42,.68);color:#d1d5db;cursor:pointer;font-weight:700;position:relative;z-index:1";
    const providerLabel = this.provider.replace("-", " ");
    const indicator = this.state.type === "active" ? STATUS_COLORS[this.state.status] : "#6b7280";

    let message = "Checking bot status...";
    let actionLabel = "Checking...";
    let actionDisabled = true;
    let actionStyle = "background:rgba(51,65,85,.78);color:#d1d5db;box-shadow:none;";
    let actionHandler: (() => void) | null = null;

    if (this.state.type === "not_configured") {
      message = "Configure API URL/token in extension popup.";
      actionLabel = "Configure";
    }

    if (this.state.type === "idle") {
      message = "Bot not invited yet.";
      actionLabel = "Invite Bot";
      actionDisabled = false;
      actionStyle = "background:linear-gradient(135deg,#67e8f9,#38bdf8 45%,#2563eb);color:#03111d;";
      actionHandler = () => void this.invite();
    }

    if (this.state.type === "inviting") {
      message = STATUS_LABELS.pending;
      actionLabel = "Inviting...";
      actionStyle = "background:linear-gradient(135deg,#60a5fa,#2563eb);color:#e0f2fe;";
    }

    if (this.state.type === "error") {
      message = this.state.message;
      actionLabel = "Retry";
      actionDisabled = false;
      actionStyle = "background:linear-gradient(135deg,#fb7185,#be123c);color:#fff1f2;";
      actionHandler = () => void this.invite();
    }

    if (this.state.type === "active") {
      message = STATUS_LABELS[this.state.status];
      actionLabel = STATUS_LABELS[this.state.status];
      actionStyle = `background:${STATUS_COLORS[this.state.status]};color:#f9fafb;box-shadow:none;`;
    }

    if (this.collapsed) {
      this.host.innerHTML = `
        <button id="squaads-expand-btn" style="display:flex;gap:10px;align-items:center;padding:11px 14px;border-radius:999px;border:1px solid rgba(148,163,184,.18);background:linear-gradient(145deg, rgba(8,15,29,.94), rgba(12,25,44,.88));color:#f8fafc;box-shadow:0 24px 60px rgba(2,8,23,.45);cursor:pointer;max-width:280px;backdrop-filter:blur(18px);">
          <span data-squaads-indicator style="width:10px;height:10px;border-radius:999px;background:${indicator};display:inline-block;flex:0 0 auto;box-shadow:0 0 16px ${indicator};"></span>
          <span data-squaads-message style="font-size:12px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;">${message}</span>
        </button>
      `;

      const expandButton = this.host.querySelector("#squaads-expand-btn");
      expandButton?.addEventListener("click", () => this.expand());
      expandButton?.addEventListener("pointerdown", (event) => this.beginDrag(event as PointerEvent));
      this.applyPosition();
      this.syncVisualState();
      return;
    }

    this.host.innerHTML = `
      <div style="${wrap}${card}">
        <div style="position:absolute;inset:0;background:radial-gradient(circle at top left, rgba(103,232,249,.10), transparent 34%),radial-gradient(circle at bottom right, rgba(99,102,241,.12), transparent 30%);pointer-events:none;"></div>
        <button id="squaads-drag-handle" style="border:0;background:transparent;color:#94a3b8;cursor:grab;padding:0 2px;font-size:14px;line-height:1;position:relative;z-index:1">⋮⋮</button>
        <span data-squaads-indicator style="width:10px;height:10px;border-radius:999px;background:${indicator};display:inline-block;flex:0 0 auto;box-shadow:0 0 18px ${indicator};position:relative;z-index:1"></span>
        <div style="${content}">
          <span style="${metaLabel}">${providerLabel}</span>
          <span data-squaads-message style="${statusLabel}">${message}</span>
        </div>
        <button id="squaads-primary-btn" style="${button}${actionStyle}" ${actionDisabled ? "disabled" : ""}>${actionLabel}</button>
        <button id="squaads-dismiss-btn" style="${dismissButton}">x</button>
      </div>
    `;

    const primaryButton = this.host.querySelector("#squaads-primary-btn") as HTMLButtonElement | null;
    const dismiss = this.host.querySelector("#squaads-dismiss-btn");
    const dragHandle = this.host.querySelector("#squaads-drag-handle");

    if (primaryButton && actionDisabled) {
      primaryButton.style.cursor = "default";
      primaryButton.style.opacity = "0.95";
    }

    if (primaryButton && actionHandler) {
      primaryButton.addEventListener("click", actionHandler);
    }

    dismiss?.addEventListener("click", () => this.collapse());
    dragHandle?.addEventListener("pointerdown", (event) => this.beginDrag(event as PointerEvent));
    this.applyPosition();
    this.syncVisualState();
  }

  private async checkStatus(passive = false): Promise<void> {
    if (this.statusRequestInFlight) return;
    this.statusRequestInFlight = true;

    if (!passive) {
      this.setState({ type: "checking" });
    }

    let res: RuntimeResponse;

    try {
      res = await send({
        type: "CHECK_STATUS",
        meetingUrl: this.meetingUrl,
        provider: this.provider,
      });
    } finally {
      this.statusRequestInFlight = false;
    }

    if (this.isInactive()) return;

    if (!res.ok) {
      const error = (res as { ok: false; error: string }).error;
      if (error.toLowerCase().includes("not configured")) {
        this.setState({ type: "not_configured" });
      } else {
        this.setState({ type: "error", message: error });
      }
      return;
    }

    const status = (res as { ok: true; data: StatusResponse }).data;
    if (!status.active || !status.meeting) {
      this.setState({ type: "idle" });
      return;
    }

    this.setState({
      type: "active",
      meetingId: status.meeting.id,
      status: status.meeting.status,
    });

    if (ACTIVE_STATUSES.includes(status.meeting.status)) {
      this.subscribe(status.meeting.id);
    }
  }

  private async invite(): Promise<void> {
    if (this.isInactive()) return;
    this.setState({ type: "inviting" });
    const res = await send({
      type: "INVITE_BOT",
      meetingUrl: this.meetingUrl,
      provider: this.provider,
    });

    if (this.isInactive()) return;

    if (!res.ok) {
      const error = (res as { ok: false; error: string }).error;
      this.setState({ type: "error", message: error });
      return;
    }

    const data = (res as { ok: true; data: { meetingId: string } }).data;
    this.setState({ type: "active", meetingId: data.meetingId, status: "pending" });
    this.subscribe(data.meetingId);
  }

  private collapse() {
    if (this.isInactive()) return;
    this.collapsed = true;
    this.mount();
    this.scheduleIdleVisuals();
  }

  private expand() {
    if (this.isInactive()) return;
    this.collapsed = false;
    this.mount();
    this.bringToFront();
  }
}
