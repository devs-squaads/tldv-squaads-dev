/// <reference types="bun" />

import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { AuthorizedAccountRepository } from "../../../../packages/shared/src/repositories/AuthorizedAccountRepository";

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

// AuthorizedAccountRepository is spied on its real, unmocked class (see
// apps/__tests__/helpers/dbSchemaMock.ts) instead of faked via mock.module,
// so this file never competes with AuthorizedAccountRepository.test.ts for
// the same resolved module path.
const { GET, POST } = await import(
  "../../../web/src/app/api/admin/authorized-accounts/route"
);

describe("GET /api/admin/authorized-accounts", () => {
  let findAllSpy: ReturnType<typeof spyOn>;
  let upsertSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetServerSession.mockClear();
    findAllSpy = spyOn(AuthorizedAccountRepository, "findAll").mockResolvedValue([] as never);
    upsertSpy = spyOn(AuthorizedAccountRepository, "upsert").mockImplementation(
      (input: Record<string, unknown>) => Promise.resolve({ ...input, id: "acc-new" } as never),
    );
  });

  afterEach(() => {
    findAllSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns 403 when the session user is not an admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "member@squaads.com", role: "member" } });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(findAllSpy).not.toHaveBeenCalled();
  });

  it("lists authorized accounts for an admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });
    findAllSpy.mockResolvedValueOnce([{ email: "member@squaads.com", role: "member", isActive: true }] as never);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
  });

  describe("POST /api/admin/authorized-accounts", () => {
    it("returns 403 when the session user is not an admin", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { email: "member@squaads.com", role: "member" } });

      const req = new Request("http://localhost/api/admin/authorized-accounts", {
        method: "POST",
        body: JSON.stringify({ email: "new@squaads.com" }),
      });

      const res = await POST(req);

      expect(res.status).toBe(403);
      expect(upsertSpy).not.toHaveBeenCalled();
    });

    it("lets an admin add a new authorized email as an active member", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { email: "admin@squaads.com", role: "admin" } });

      const req = new Request("http://localhost/api/admin/authorized-accounts", {
        method: "POST",
        body: JSON.stringify({ email: "New@Squaads.com" }),
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@squaads.com",
          role: "member",
          isActive: true,
          invitedBy: "admin@squaads.com",
        }),
      );
    });
  });
});
