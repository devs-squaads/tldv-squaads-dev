/// <reference types="bun" />

import { describe, expect, it, mock, spyOn, beforeEach, afterEach, afterAll } from "bun:test";
const AuthorizedAccountRepository = { findAll: mock(() => Promise.resolve([] as never[])), findByEmail: mock(() => Promise.resolve(null as never)), remove: mock(() => Promise.resolve()), setActive: mock(() => Promise.resolve()), setRole: mock(() => Promise.resolve()) };

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

const mockGetServerSession = mock(() => Promise.resolve(null as unknown));
bunMock.module("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));

// Inject local doubles without loading the production repository.
const { createAuthorizedAccountEmailHandlers } = await import(
  "../../../web/src/auth"
);
const { PATCH, DELETE } = await createAuthorizedAccountEmailHandlers({ getServerSession: mockGetServerSession, AuthorizedAccountRepository });

type AccountRow = { email: string; role: "admin" | "member"; isActive: boolean };

afterAll(() => {
  delete (globalThis as typeof globalThis & { __squaadsAdminRouteDependencies?: unknown }).__squaadsAdminRouteDependencies;
});

describe("PATCH /api/admin/authorized-accounts/[email]", () => {
  let setActiveSpy: ReturnType<typeof spyOn>;
  let setRoleSpy: ReturnType<typeof spyOn>;
  let removeSpy: ReturnType<typeof spyOn>;
  let findAllSpy: ReturnType<typeof spyOn>;
  let findByEmailSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetServerSession.mockClear();
    setActiveSpy = spyOn(AuthorizedAccountRepository, "setActive").mockResolvedValue(undefined as never);
    setRoleSpy = spyOn(AuthorizedAccountRepository, "setRole").mockResolvedValue(undefined as never);
    removeSpy = spyOn(AuthorizedAccountRepository, "remove").mockResolvedValue(undefined as never);
    findAllSpy = spyOn(AuthorizedAccountRepository, "findAll").mockResolvedValue([] as never);
    findByEmailSpy = spyOn(AuthorizedAccountRepository, "findByEmail").mockResolvedValue(null as never);
  });

  afterEach(() => {
    setActiveSpy.mockRestore();
    setRoleSpy.mockRestore();
    removeSpy.mockRestore();
    findAllSpy.mockRestore();
    findByEmailSpy.mockRestore();
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/admin/authorized-accounts/member@squaads.com", {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ email: "member@squaads.com" }) });

    expect(res.status).toBe(401);
    expect(setActiveSpy).not.toHaveBeenCalled();
  });

  it("returns 403 when the session user is not an admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "member@squaads.com", role: "member" } });

    const req = new Request("http://localhost/api/admin/authorized-accounts/member@squaads.com", {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ email: "member@squaads.com" }) });

    expect(res.status).toBe(403);
    expect(setActiveSpy).not.toHaveBeenCalled();
  });

  it("lets an admin deactivate an authorized email", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });

    const req = new Request(
      "http://localhost/api/admin/authorized-accounts/member%40squaads.com",
      {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      },
    );

    const res = await PATCH(req, { params: Promise.resolve({ email: "member%40squaads.com" }) });

    expect(res.status).toBe(200);
    expect(setActiveSpy).toHaveBeenCalledWith("member@squaads.com", false);
  });

  it("lets an admin change a member's role", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });
    findByEmailSpy.mockResolvedValueOnce({ email: "member@squaads.com", role: "member", isActive: true } as never);

    const req = new Request("http://localhost/api/admin/authorized-accounts/member%40squaads.com", {
      method: "PATCH",
      body: JSON.stringify({ role: "admin" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ email: "member%40squaads.com" }) });

    expect(res.status).toBe(200);
    expect(setRoleSpy).toHaveBeenCalledWith("member@squaads.com", "admin");
  });

  it("blocks an admin from modifying their own access", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });

    const req = new Request("http://localhost/api/admin/authorized-accounts/admin%40squaads.com", {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ email: "admin%40squaads.com" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("No podés modificar tu propio acceso.");
    expect(setRoleSpy).not.toHaveBeenCalled();
    expect(setActiveSpy).not.toHaveBeenCalled();
  });

  it("blocks demoting the last active admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });
    const target: AccountRow = { email: "other-admin@squaads.com", role: "admin", isActive: true };
    findByEmailSpy.mockResolvedValueOnce(target as never);
    findAllSpy.mockResolvedValueOnce([target] as never);

    const req = new Request("http://localhost/api/admin/authorized-accounts/other-admin%40squaads.com", {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ email: "other-admin%40squaads.com" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Debe quedar al menos un administrador activo.");
    expect(setRoleSpy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/authorized-accounts/[email]", () => {
  let removeSpy: ReturnType<typeof spyOn>;
  let findAllSpy: ReturnType<typeof spyOn>;
  let findByEmailSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetServerSession.mockClear();
    removeSpy = spyOn(AuthorizedAccountRepository, "remove").mockResolvedValue(undefined as never);
    findAllSpy = spyOn(AuthorizedAccountRepository, "findAll").mockResolvedValue([] as never);
    findByEmailSpy = spyOn(AuthorizedAccountRepository, "findByEmail").mockResolvedValue(null as never);
  });

  afterEach(() => {
    removeSpy.mockRestore();
    findAllSpy.mockRestore();
    findByEmailSpy.mockRestore();
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/admin/authorized-accounts/member@squaads.com", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ email: "member@squaads.com" }) });

    expect(res.status).toBe(401);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("returns 403 when the session user is not an admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "member@squaads.com", role: "member" } });

    const req = new Request("http://localhost/api/admin/authorized-accounts/member@squaads.com", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ email: "member@squaads.com" }) });

    expect(res.status).toBe(403);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("lets an admin delete a member account", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });
    findByEmailSpy.mockResolvedValueOnce({ email: "member@squaads.com", role: "member", isActive: true } as never);

    const req = new Request("http://localhost/api/admin/authorized-accounts/member%40squaads.com", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ email: "member%40squaads.com" }) });

    expect(res.status).toBe(200);
    expect(removeSpy).toHaveBeenCalledWith("member@squaads.com");
  });

  it("blocks an admin from deleting their own access", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });

    const req = new Request("http://localhost/api/admin/authorized-accounts/admin%40squaads.com", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ email: "admin%40squaads.com" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("No podés modificar tu propio acceso.");
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("blocks deleting the last active admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });
    const target: AccountRow = { email: "other-admin@squaads.com", role: "admin", isActive: true };
    findByEmailSpy.mockResolvedValueOnce(target as never);
    findAllSpy.mockResolvedValueOnce([target] as never);

    const req = new Request("http://localhost/api/admin/authorized-accounts/other-admin%40squaads.com", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ email: "other-admin%40squaads.com" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Debe quedar al menos un administrador activo.");
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
