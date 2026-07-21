import { describe, expect, it } from "bun:test";
import type { MeetingStatus } from "../../../extension/src/shared/types";
import {
  diff,
  initialState,
  intervalFor,
  transition,
  type SyncState,
  type WidgetRenderState,
} from "../../../extension/src/shared/status-sync";

const active = (status: MeetingStatus): WidgetRenderState => ({ type: "active", status });

describe("statusSync.diff", () => {
  it("returns an empty patch when the state is identical", () => {
    const prev = active("recording");
    const next = active("recording");

    const patch = diff(prev, next);

    expect(patch).toEqual({ attribute: "none" });
  });

  it("returns a status patch when only the status changed within the active type", () => {
    const prev = active("joining");
    const next = active("recording");

    const patch = diff(prev, next);

    expect(patch).toEqual({ attribute: "status", value: "recording" });
  });

  it("returns a full patch when the widget type changed", () => {
    const prev: WidgetRenderState = { type: "idle", status: null };
    const next = active("pending");

    const patch = diff(prev, next);

    expect(patch).toEqual({ attribute: "full" });
  });

  it("returns an empty patch when both states are non-active with the same type", () => {
    const prev: WidgetRenderState = { type: "idle", status: null };
    const next: WidgetRenderState = { type: "idle", status: null };

    const patch = diff(prev, next);

    expect(patch).toEqual({ attribute: "none" });
  });

  it("returns a full patch when transitioning from active to a terminal type", () => {
    const prev = active("recording");
    const next: WidgetRenderState = { type: "error", status: null };

    const patch = diff(prev, next);

    expect(patch).toEqual({ attribute: "full" });
  });
});

describe("statusSync.intervalFor", () => {
  it("returns 2s for transient phases", () => {
    expect(intervalFor("pending")).toBe(2000);
    expect(intervalFor("joining")).toBe(2000);
    expect(intervalFor("waiting_admission")).toBe(2000);
  });

  it("returns 5s for stable phases", () => {
    expect(intervalFor("recording")).toBe(5000);
    expect(intervalFor("transcribing")).toBe(5000);
    expect(intervalFor("summarizing")).toBe(5000);
  });

  it("returns 5s default for terminal statuses (loop stops before next tick)", () => {
    expect(intervalFor("completed")).toBe(5000);
    expect(intervalFor("error")).toBe(5000);
  });
});

describe("statusSync.transition", () => {
  it("SUBSCRIBE first subscriber starts the loop and fetches the initial snapshot", () => {
    const state = initialState();

    const result = transition(state, { type: "SUBSCRIBE", meetingId: "m1", portId: "p1" });

    expect(result.effects).toEqual([
      { type: "startLoop", meetingId: "m1", interval: 2000 },
      { type: "fetchSnapshot", meetingId: "m1", portId: "p1" },
    ]);
    // inFlight is false — the SW sets it via POLL_TICK when it actually launches
    // the fetch (fetchSnapshot triggers POLL_TICK internally).
    expect(result.state.meetings["m1"]).toEqual({
      portIds: ["p1"],
      inFlight: false,
      lastStatus: null,
      interval: 2000,
    });
  });

  it("SUBSCRIBE second subscriber fetches snapshot without restarting the loop", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: true, lastStatus: null, interval: 2000 },
      },
    };

    const result = transition(state, { type: "SUBSCRIBE", meetingId: "m1", portId: "p2" });

    expect(result.effects).toEqual([
      { type: "fetchSnapshot", meetingId: "m1", portId: "p2" },
    ]);
    expect(result.state.meetings["m1"].portIds).toEqual(["p1", "p2"]);
    expect(result.state.meetings["m1"].inFlight).toBe(true);
  });

  it("DISCONNECT last port stops the loop and removes the meeting", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: false, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "DISCONNECT", meetingId: "m1", portId: "p1" });

    expect(result.effects).toEqual([{ type: "stopLoop", meetingId: "m1" }]);
    expect(result.state.meetings["m1"]).toBeUndefined();
  });

  it("DISCONNECT non-last port just removes the port (no effects)", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1", "p2"], inFlight: false, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "DISCONNECT", meetingId: "m1", portId: "p1" });

    expect(result.effects).toEqual([]);
    expect(result.state.meetings["m1"].portIds).toEqual(["p2"]);
  });

  it("POLL_RESPONSE terminal broadcasts, stops the loop and disconnects all ports", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1", "p2"], inFlight: true, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "POLL_RESPONSE", meetingId: "m1", status: "completed" });

    expect(result.effects).toEqual([
      { type: "broadcast", meetingId: "m1", status: "completed" },
      { type: "stopLoop", meetingId: "m1" },
      { type: "disconnectPorts", meetingId: "m1" },
    ]);
    expect(result.state.meetings["m1"]).toBeUndefined();
  });

  it("POLL_RESPONSE with no request in flight is a no-op (stale response)", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: false, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "POLL_RESPONSE", meetingId: "m1", status: "recording" });

    expect(result.effects).toEqual([]);
    expect(result.state).toEqual(state);
  });

  it("POLL_RESPONSE for an unknown meeting is a no-op", () => {
    const state = initialState();

    const result = transition(state, { type: "POLL_RESPONSE", meetingId: "ghost", status: "recording" });

    expect(result.effects).toEqual([]);
    expect(result.state).toEqual(state);
  });

  it("POLL_RESPONSE non-terminal broadcasts the new status and clears inFlight", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: true, lastStatus: "joining", interval: 2000 },
      },
    };

    const result = transition(state, { type: "POLL_RESPONSE", meetingId: "m1", status: "recording" });

    expect(result.effects).toEqual([
      { type: "broadcast", meetingId: "m1", status: "recording" },
    ]);
    expect(result.state.meetings["m1"].inFlight).toBe(false);
    expect(result.state.meetings["m1"].lastStatus).toBe("recording");
    expect(result.state.meetings["m1"].interval).toBe(5000);
  });

  it("POLL_TICK when a request is in flight is a no-op (skip the tick)", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: true, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "POLL_TICK", meetingId: "m1" });

    expect(result.effects).toEqual([]);
    expect(result.state).toEqual(state);
  });

  it("POLL_TICK when no request is in flight fetches the meeting and sets inFlight", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: false, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "POLL_TICK", meetingId: "m1" });

    expect(result.effects).toEqual([{ type: "fetchMeeting", meetingId: "m1" }]);
    expect(result.state.meetings["m1"].inFlight).toBe(true);
  });

  it("HANDSHAKE_TIMEOUT emits disconnectPort for the zombie port", () => {
    const state = initialState();

    const result = transition(state, { type: "HANDSHAKE_TIMEOUT", portId: "p1" });

    expect(result.effects).toEqual([{ type: "disconnectPort", portId: "p1" }]);
    expect(result.state).toEqual(state);
  });

  it("POLL_ERROR clears inFlight so the loop can recover (no broadcast, no stop)", () => {
    const state: SyncState = {
      meetings: {
        m1: { portIds: ["p1"], inFlight: true, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, { type: "POLL_ERROR", meetingId: "m1" });

    expect(result.effects).toEqual([]);
    expect(result.state.meetings["m1"].inFlight).toBe(false);
    expect(result.state.meetings["m1"].lastStatus).toBe("recording");
  });

  it("POLL_ERROR for an unknown meeting is a no-op", () => {
    const state = initialState();

    const result = transition(state, { type: "POLL_ERROR", meetingId: "ghost" });

    expect(result.effects).toEqual([]);
    expect(result.state).toEqual(state);
  });
});

describe("statusSync.transition — multi-meeting isolation", () => {
  it("supports two independent meetings with separate ports", () => {
    let state = initialState();

    state = transition(state, { type: "SUBSCRIBE", meetingId: "meeting-a", portId: "port-a1" }).state;
    state = transition(state, { type: "SUBSCRIBE", meetingId: "meeting-b", portId: "port-b1" }).state;

    expect(state.meetings["meeting-a"].portIds).toEqual(["port-a1"]);
    expect(state.meetings["meeting-b"].portIds).toEqual(["port-b1"]);
  });

  it("a broadcast for one meeting does not affect the other", () => {
    const state: SyncState = {
      meetings: {
        "meeting-a": { portIds: ["port-a1"], inFlight: true, lastStatus: "joining", interval: 2000 },
        "meeting-b": { portIds: ["port-b1"], inFlight: true, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, {
      type: "POLL_RESPONSE",
      meetingId: "meeting-a",
      status: "recording",
    });

    // Only meeting-a is broadcast and updated; meeting-b is untouched
    expect(result.effects).toEqual([
      { type: "broadcast", meetingId: "meeting-a", status: "recording" },
    ]);
    expect(result.state.meetings["meeting-a"].lastStatus).toBe("recording");
    expect(result.state.meetings["meeting-b"]).toEqual({
      portIds: ["port-b1"],
      inFlight: true,
      lastStatus: "recording",
      interval: 5000,
    });
  });

  it("a terminal POLL_RESPONSE for one meeting stops only that meeting's loop", () => {
    const state: SyncState = {
      meetings: {
        "meeting-a": { portIds: ["port-a1"], inFlight: true, lastStatus: "recording", interval: 5000 },
        "meeting-b": { portIds: ["port-b1"], inFlight: true, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, {
      type: "POLL_RESPONSE",
      meetingId: "meeting-a",
      status: "completed",
    });

    // meeting-a is removed (terminal), meeting-b is still alive
    expect(result.state.meetings["meeting-a"]).toBeUndefined();
    expect(result.state.meetings["meeting-b"]).toBeDefined();
    // Effects reference only meeting-a
    expect(result.effects.every((e) => "meetingId" in e && e.meetingId === "meeting-a")).toBe(true);
  });

  it("DISCONNECT on one meeting does not affect the other", () => {
    const state: SyncState = {
      meetings: {
        "meeting-a": { portIds: ["port-a1"], inFlight: false, lastStatus: "recording", interval: 5000 },
        "meeting-b": { portIds: ["port-b1"], inFlight: false, lastStatus: "recording", interval: 5000 },
      },
    };

    const result = transition(state, {
      type: "DISCONNECT",
      meetingId: "meeting-a",
      portId: "port-a1",
    });

    expect(result.state.meetings["meeting-a"]).toBeUndefined();
    expect(result.state.meetings["meeting-b"]).toEqual({
      portIds: ["port-b1"],
      inFlight: false,
      lastStatus: "recording",
      interval: 5000,
    });
  });
});
