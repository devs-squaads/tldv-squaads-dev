/**
 * Pure state machine for meeting status synchronization.
 *
 * The service worker delegates all polling/subscription decisions to this
 * module. It is intentionally side-effect free: `{state, event} -> {newState,
 * effects[]}`. The SW executes the returned effects (ADT) against Chrome APIs.
 *
 * Design contract: spec/features/007-extension-status-sync/plan.md
 */

import type { MeetingStatus } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Polling interval for transient phases (pending / joining / waiting_admission). */
export const TRANSITION_INTERVAL_MS = 2000;

/** Polling interval for stable phases (recording / transcribing / summarizing). */
export const STABLE_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Widget diff
// ---------------------------------------------------------------------------

/** Widget state types that affect rendering. */
export type WidgetStateType =
  | "checking"
  | "not_configured"
  | "idle"
  | "inviting"
  | "active"
  | "error";

/** Minimal render-relevant state: type + status (status only when active). */
export interface WidgetRenderState {
  type: WidgetStateType;
  status: MeetingStatus | null;
}

/**
 * Surgical render patch produced by `diff`.
 *
 * - `none`  — nothing changed; the widget must NOT re-render.
 * - `status`— only the MeetingStatus changed (within `active`); patch label,
 *              color and indicator without rebuilding the DOM node.
 * - `full`  — the widget type changed; full re-render (innerHTML) required.
 */
export type WidgetPatch =
  | { attribute: "none" }
  | { attribute: "full" }
  | { attribute: "status"; value: MeetingStatus };

/**
 * Compares two render states and returns the minimal patch needed.
 *
 * - Same type + same status -> `none` (no re-render, preserves drag).
 * - Same type `active`, different status -> `status` (surgical patch).
 * - Different type -> `full` (full re-render).
 */
export function diff(prev: WidgetRenderState, next: WidgetRenderState): WidgetPatch {
  if (prev.type !== next.type) {
    return { attribute: "full" };
  }

  if (prev.type === "active" && next.type === "active") {
    if (prev.status !== next.status) {
      return { attribute: "status", value: next.status };
    }
  }

  return { attribute: "none" };
}

// ---------------------------------------------------------------------------
// Adaptive interval
// ---------------------------------------------------------------------------

/**
 * Returns the adaptive polling interval (ms) for a meeting status.
 *
 * - 2s for transient phases (pending / joining / waiting_admission).
 * - 5s for stable phases (recording / transcribing / summarizing).
 * - 5s default for terminal statuses (the loop is stopped before the next
 *   tick, so this value is never used in practice — kept for totality).
 */
export function intervalFor(status: MeetingStatus): number {
  switch (status) {
    case "pending":
    case "joining":
    case "waiting_admission":
      return TRANSITION_INTERVAL_MS;
    case "recording":
    case "transcribing":
    case "summarizing":
      return STABLE_INTERVAL_MS;
    default:
      return STABLE_INTERVAL_MS;
  }
}

// ---------------------------------------------------------------------------
// State machine — types (implemented in subsequent TDD cycles)
// ---------------------------------------------------------------------------

/** Opaque identifier for a Chrome runtime Port (SW maps this to a real Port). */
export type PortId = string;

/** Per-meeting loop state tracked by the state machine. */
export interface MeetingLoopState {
  portIds: PortId[];
  inFlight: boolean;
  lastStatus: MeetingStatus | null;
  interval: number;
}

/** Top-level state: meetingId -> loop state. */
export interface SyncState {
  meetings: Record<string, MeetingLoopState>;
}

/** Events the SW dispatches to the state machine. */
export type SyncEvent =
  | { type: "SUBSCRIBE"; meetingId: string; portId: PortId }
  | { type: "POLL_TICK"; meetingId: string }
  | { type: "POLL_RESPONSE"; meetingId: string; status: MeetingStatus }
  | { type: "POLL_ERROR"; meetingId: string }
  | { type: "DISCONNECT"; meetingId: string; portId: PortId }
  | { type: "HANDSHAKE_TIMEOUT"; portId: PortId };

/** ADT effects the SW must execute. */
export type SyncEffect =
  | { type: "startLoop"; meetingId: string; interval: number }
  | { type: "stopLoop"; meetingId: string }
  | { type: "fetchSnapshot"; meetingId: string; portId: PortId }
  | { type: "fetchMeeting"; meetingId: string }
  | { type: "broadcast"; meetingId: string; status: MeetingStatus }
  | { type: "disconnectPorts"; meetingId: string }
  | { type: "disconnectPort"; portId: PortId };

/** Result of a transition: new immutable state + effects to execute. */
export interface TransitionResult {
  state: SyncState;
  effects: SyncEffect[];
}

/** Terminal statuses that trigger final broadcast + cleanup. */
const TERMINAL_STATUSES: MeetingStatus[] = [
  "completed",
  "admission_timeout",
  "rejected",
  "error",
];

function isTerminal(status: MeetingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Empty initial state (no meetings tracked). */
export function initialState(): SyncState {
  return { meetings: {} };
}

/** Returns a copy of `state` with the meeting removed from the registry. */
function removeMeeting(state: SyncState, meetingId: string): SyncState {
  const meetings = { ...state.meetings };
  delete meetings[meetingId];
  return { meetings };
}

/** Returns a copy of `state` with one meeting loop replaced by `loop`. */
function setMeeting(state: SyncState, meetingId: string, loop: MeetingLoopState): SyncState {
  return { meetings: { ...state.meetings, [meetingId]: loop } };
}

/**
 * SUBSCRIBE — a consumer (widget or popup) subscribes to a meeting.
 *
 * - First subscriber for this meeting: register the loop, start it, and fetch
 *   the initial snapshot for the port. inFlight is set true (the snapshot
 *   fetch is in progress).
 * - Second+ subscriber: just fetch the snapshot for the new port; the loop
 *   is already running.
 */
function handleSubscribe(
  state: SyncState,
  event: { meetingId: string; portId: PortId },
): TransitionResult {
  const existing = state.meetings[event.meetingId];

  if (!existing) {
    const interval = intervalFor("pending");
    const loop: MeetingLoopState = {
      portIds: [event.portId],
      inFlight: false,
      lastStatus: null,
      interval,
    };
    return {
      state: setMeeting(state, event.meetingId, loop),
      effects: [
        { type: "startLoop", meetingId: event.meetingId, interval },
        { type: "fetchSnapshot", meetingId: event.meetingId, portId: event.portId },
      ],
    };
  }

  const loop: MeetingLoopState = {
    ...existing,
    portIds: [...existing.portIds, event.portId],
  };
  return {
    state: setMeeting(state, event.meetingId, loop),
    effects: [
      { type: "fetchSnapshot", meetingId: event.meetingId, portId: event.portId },
    ],
  };
}

/**
 * POLL_TICK — the adaptive timer fired for a meeting.
 *
 * - Unknown meeting or inFlight request: no-op (discard the tick).
 * - Otherwise: set inFlight and fetch the meeting (broadcast to all ports on
 *   resolution).
 */
function handlePollTick(state: SyncState, event: { meetingId: string }): TransitionResult {
  const meeting = state.meetings[event.meetingId];
  if (!meeting || meeting.inFlight) {
    return { state, effects: [] };
  }

  const loop: MeetingLoopState = { ...meeting, inFlight: true };
  return {
    state: setMeeting(state, event.meetingId, loop),
    effects: [{ type: "fetchMeeting", meetingId: event.meetingId }],
  };
}

/**
 * POLL_RESPONSE — a poll fetch resolved with a status.
 *
 * - Unknown meeting or no request in flight: no-op (stale/duplicate response).
 * - Terminal status: broadcast to all ports, stop the loop, disconnect all
 *   ports, then remove the meeting from the registry.
 * - Non-terminal status: broadcast to all ports, clear inFlight, update
 *   lastStatus + adaptive interval.
 */
function handlePollResponse(
  state: SyncState,
  event: { meetingId: string; status: MeetingStatus },
): TransitionResult {
  const meeting = state.meetings[event.meetingId];
  if (!meeting || !meeting.inFlight) {
    return { state, effects: [] };
  }

  if (isTerminal(event.status)) {
    return {
      state: removeMeeting(state, event.meetingId),
      effects: [
        { type: "broadcast", meetingId: event.meetingId, status: event.status },
        { type: "stopLoop", meetingId: event.meetingId },
        { type: "disconnectPorts", meetingId: event.meetingId },
      ],
    };
  }

  const loop: MeetingLoopState = {
    ...meeting,
    inFlight: false,
    lastStatus: event.status,
    interval: intervalFor(event.status),
  };
  return {
    state: setMeeting(state, event.meetingId, loop),
    effects: [{ type: "broadcast", meetingId: event.meetingId, status: event.status }],
  };
}

/**
 * DISCONNECT — a Port disconnected (onDisconnect).
 *
 * - Unknown meeting: no-op.
 * - Last port for the meeting: stop the loop and remove the meeting.
 * - Other ports remain: just remove this port.
 */
function handleDisconnect(
  state: SyncState,
  event: { meetingId: string; portId: PortId },
): TransitionResult {
  const meeting = state.meetings[event.meetingId];
  if (!meeting) {
    return { state, effects: [] };
  }

  const remainingPorts = meeting.portIds.filter((id) => id !== event.portId);

  if (remainingPorts.length === 0) {
    return {
      state: removeMeeting(state, event.meetingId),
      effects: [{ type: "stopLoop", meetingId: event.meetingId }],
    };
  }

  const loop: MeetingLoopState = { ...meeting, portIds: remainingPorts };
  return {
    state: setMeeting(state, event.meetingId, loop),
    effects: [],
  };
}

/**
 * POLL_ERROR — a poll fetch failed (network error or timeout).
 *
 * Clears inFlight so the loop can recover on the next tick. Does NOT
 * broadcast (the last known status remains displayed) and does NOT stop
 * the loop (transient errors are retried).
 */
function handlePollError(state: SyncState, event: { meetingId: string }): TransitionResult {
  const meeting = state.meetings[event.meetingId];
  if (!meeting || !meeting.inFlight) {
    return { state, effects: [] };
  }

  const loop: MeetingLoopState = { ...meeting, inFlight: false };
  return {
    state: setMeeting(state, event.meetingId, loop),
    effects: [],
  };
}

/**
 * HANDSHAKE_TIMEOUT — a Port did not send SUBSCRIBE within 2s.
 *
 * Emits `disconnectPort` for the zombie port. The port was never registered
 * in a meeting (no SUBSCRIBE), so no meeting state changes.
 */
function handleHandshakeTimeout(state: SyncState, event: { portId: PortId }): TransitionResult {
  return {
    state,
    effects: [{ type: "disconnectPort", portId: event.portId }],
  };
}

/**
 * Pure state machine transition: `{state, event} -> {newState, effects[]}`.
 *
 * The SW calls this for every event (SUBSCRIBE, POLL_TICK, POLL_RESPONSE,
 * DISCONNECT, HANDSHAKE_TIMEOUT) and executes the returned effects in order.
 */
export function transition(state: SyncState, event: SyncEvent): TransitionResult {
  switch (event.type) {
    case "SUBSCRIBE":
      return handleSubscribe(state, event);
    case "POLL_TICK":
      return handlePollTick(state, event);
    case "POLL_RESPONSE":
      return handlePollResponse(state, event);
    case "POLL_ERROR":
      return handlePollError(state, event);
    case "DISCONNECT":
      return handleDisconnect(state, event);
    case "HANDSHAKE_TIMEOUT":
      return handleHandshakeTimeout(state, event);
  }
}
