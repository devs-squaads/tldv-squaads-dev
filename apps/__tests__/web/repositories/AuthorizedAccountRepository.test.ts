import { describe, expect, it, mock, beforeEach } from "bun:test";
import { mockDrizzleOrmModule, mockDbSchemaModule } from "../../helpers/dbSchemaMock";

type AccountRow = {
  id: string;
  email: string;
  role: "admin" | "member";
  isActive: boolean;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EqCondition = { __op: "eq"; value: unknown };

type QueryState = {
  rows: AccountRow[];
  updateCalls: Array<{ email: string; data: Record<string, unknown> }>;
  insertCalls: AccountRow[];
  deleteCalls: string[];
};

const state: QueryState = { rows: [], updateCalls: [], insertCalls: [], deleteCalls: [] };

function resetState() {
  state.rows = [];
  state.updateCalls = [];
  state.insertCalls = [];
  state.deleteCalls = [];
}

// where()/limit() intentionally ignore the eq() condition's shape (see
// apps/__tests__/helpers/dbSchemaMock.ts) — each test sets `state.rows` to
// exactly the row(s) relevant to that scenario instead.
const dbMock = {
  select() {
    return {
      from() {
        return {
          where() {
            return { limit: () => Promise.resolve(state.rows) };
          },
          // findAll() has no where() — select().from() must itself be awaitable.
          then(resolve: (rows: AccountRow[]) => void) {
            resolve(state.rows);
          },
        };
      },
    };
  },
  update() {
    return {
      set(data: Record<string, unknown>) {
        return {
          where: (condition: EqCondition) => {
            state.updateCalls.push({ email: String(condition.value), data });
            return Promise.resolve();
          },
        };
      },
    };
  },
  insert() {
    return {
      values: (values: AccountRow) => {
        state.insertCalls.push(values);
        state.rows.push(values);
        return Promise.resolve();
      },
    };
  },
  delete() {
    return {
      where: (condition: EqCondition) => {
        state.deleteCalls.push(String(condition.value));
        return Promise.resolve();
      },
    };
  },
};

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

// These two specifiers must stay in sync with every other repository test's
// mock — bun's mock.module() resolves per process, not per file.
bunMock.module("drizzle-orm", mockDrizzleOrmModule);
bunMock.module("@meeting-bot/shared/db/schema", mockDbSchemaModule);
bunMock.module("@meeting-bot/shared/db", () => ({ db: dbMock }));

const { AuthorizedAccountRepository } = await import(
  "../../../../packages/shared/src/repositories/AuthorizedAccountRepository"
);

describe("AuthorizedAccountRepository", () => {
  beforeEach(() => {
    resetState();
  });

  describe("findByEmail", () => {
    it("returns null when the email has no authorized account", async () => {
      const result = await AuthorizedAccountRepository.findByEmail("nobody@squaads.com");
      expect(result).toBeNull();
    });

    it("returns the account when it exists", async () => {
      state.rows = [
        {
          id: "acc-1",
          email: "admin@squaads.com",
          role: "admin",
          isActive: true,
          invitedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = await AuthorizedAccountRepository.findByEmail("admin@squaads.com");
      expect(result?.email).toBe("admin@squaads.com");
      expect(result?.role).toBe("admin");
    });
  });

  describe("upsert", () => {
    it("inserts a new authorized account when none exists", async () => {
      const result = await AuthorizedAccountRepository.upsert({
        email: "new@squaads.com",
        role: "member",
        isActive: true,
      });

      expect(result.email).toBe("new@squaads.com");
      expect(result.role).toBe("member");
      expect(result.isActive).toBe(true);
      expect(state.insertCalls).toHaveLength(1);
      expect(state.updateCalls).toHaveLength(0);
    });

    it("updates the role and active flag when the account already exists", async () => {
      state.rows = [
        {
          id: "acc-2",
          email: "existing@squaads.com",
          role: "member",
          isActive: true,
          invitedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = await AuthorizedAccountRepository.upsert({
        email: "existing@squaads.com",
        role: "admin",
        isActive: true,
      });

      expect(result.role).toBe("admin");
      expect(state.updateCalls).toHaveLength(1);
      expect(state.updateCalls[0]?.email).toBe("existing@squaads.com");
      expect(state.insertCalls).toHaveLength(0);
    });
  });

  describe("setActive", () => {
    it("deactivates an existing account", async () => {
      await AuthorizedAccountRepository.setActive("someone@squaads.com", false);

      expect(state.updateCalls).toHaveLength(1);
      expect(state.updateCalls[0]?.email).toBe("someone@squaads.com");
      expect(state.updateCalls[0]?.data.isActive).toBe(false);
    });
  });

  describe("setRole", () => {
    it("updates the role of an existing account", async () => {
      await AuthorizedAccountRepository.setRole("someone@squaads.com", "admin");

      expect(state.updateCalls).toHaveLength(1);
      expect(state.updateCalls[0]?.email).toBe("someone@squaads.com");
      expect(state.updateCalls[0]?.data.role).toBe("admin");
    });
  });

  describe("remove", () => {
    it("deletes an existing account", async () => {
      await AuthorizedAccountRepository.remove("someone@squaads.com");

      expect(state.deleteCalls).toHaveLength(1);
      expect(state.deleteCalls[0]).toBe("someone@squaads.com");
    });
  });

  describe("findAll", () => {
    it("returns every authorized account", async () => {
      state.rows = [
        {
          id: "acc-1",
          email: "a@squaads.com",
          role: "member",
          isActive: true,
          invitedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "acc-2",
          email: "b@squaads.com",
          role: "admin",
          isActive: false,
          invitedBy: "a@squaads.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = await AuthorizedAccountRepository.findAll();
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.email)).toEqual(["a@squaads.com", "b@squaads.com"]);
    });
  });
});
