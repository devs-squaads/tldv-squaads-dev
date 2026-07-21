/// <reference types="bun" />

import { describe, expect, it, mock, beforeEach } from "bun:test";

type MeetingStub = { status: string };

const state = {
  meetings: [] as MeetingStub[],
  settings: {} as Record<string, string>,
  meetingsShouldReject: false,
  settingsShouldReject: false,
};

function resetState() {
  state.meetings = [];
  state.settings = {};
  state.meetingsShouldReject = false;
  state.settingsShouldReject = false;
}

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

// WebMeetingRepository/WebSettingsRepository are not exercised by any other
// test file (see apps/__tests__/web/integrations), so mocking these bare
// specifiers here does not compete with another test's mock.module() call.
bunMock.module("@/repositories/WebMeetingRepository", () => ({
  WebMeetingRepository: {
    listRecent: () =>
      state.meetingsShouldReject
        ? Promise.reject(new Error("db down"))
        : Promise.resolve(state.meetings),
  },
}));

bunMock.module("@/repositories/WebSettingsRepository", () => ({
  WebSettingsRepository: {
    toRecord: () =>
      state.settingsShouldReject
        ? Promise.reject(new Error("db down"))
        : Promise.resolve(state.settings),
  },
}));

const { buildUserContext } = await import(
  "../../../web/src/integrations/chat/knowledge/userContext"
);

describe("buildUserContext — role injection", () => {
  beforeEach(() => {
    resetState();
  });

  it("includes the admin role line when role is admin", async () => {
    const context = await buildUserContext({ userId: "user-1", role: "admin" });
    expect(context).toContain("Rol del usuario: admin");
  });

  it("includes the member role line when role is member", async () => {
    const context = await buildUserContext({ userId: "user-1", role: "member" });
    expect(context).toContain("Rol del usuario: member");
  });

  it("does not throw and omits the role line when no role is given", async () => {
    const context = await buildUserContext({ userId: "user-1" });
    expect(context).not.toContain("Rol del usuario");
  });

  it("still shows the role line when the repositories reject (fallback path)", async () => {
    state.meetingsShouldReject = true;
    state.settingsShouldReject = true;
    const context = await buildUserContext({ userId: "user-1", role: "admin" });
    expect(context).toContain("Rol del usuario: admin");
  });
});
