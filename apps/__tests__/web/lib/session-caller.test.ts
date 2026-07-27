/// <reference types="bun" />

import { describe, expect, it, mock, beforeEach } from "bun:test";

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

const mockGetServerSession = mock(() => Promise.resolve(null as unknown));
bunMock.module("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));
bunMock.module("@/auth", () => ({
  authOptions: {},
}));

const { requireCaller } = await import("../../../web/src/lib/sessionCaller");

describe("requireCaller", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
  });

  it("throws Unauthorized when there is no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    await expect(requireCaller()).rejects.toThrow("Unauthorized");
  });

  it("throws Unauthorized when the session has no user id", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(requireCaller()).rejects.toThrow("Unauthorized");
  });

  it("throws Unauthorized when the session has no role", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    await expect(requireCaller()).rejects.toThrow("Unauthorized");
  });

  it("returns { id, role } for an admin session", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "admin" } });
    const caller = await requireCaller();
    expect(caller).toEqual({ id: "user-1", role: "admin" });
  });

  it("returns { id, role } for a member session", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-2", role: "member" } });
    const caller = await requireCaller();
    expect(caller).toEqual({ id: "user-2", role: "member" });
  });
});
