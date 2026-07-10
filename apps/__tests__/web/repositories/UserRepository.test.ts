import { describe, expect, it, mock, beforeEach } from "bun:test";
import { mockDrizzleOrmModule, mockDbSchemaModule } from "../../helpers/dbSchemaMock";

type UserRow = Record<string, unknown> & { id: string; email: string };

const state: { rows: UserRow[]; insertCalls: UserRow[]; updateCalls: Array<Record<string, unknown>> } = {
  rows: [],
  insertCalls: [],
  updateCalls: [],
};

function resetState() {
  state.rows = [];
  state.insertCalls = [];
  state.updateCalls = [];
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
        };
      },
    };
  },
  update() {
    return {
      set(data: Record<string, unknown>) {
        return {
          where: () => {
            state.updateCalls.push(data);
            return Promise.resolve();
          },
        };
      },
    };
  },
  insert() {
    return {
      values: (values: UserRow) => {
        state.insertCalls.push(values);
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

const { UserRepository } = await import("../../../web/src/repositories/UserRepository");

describe("UserRepository.upsertFromGoogle", () => {
  beforeEach(() => {
    resetState();
  });

  it("creates a new user with calendarEnabled false (Calendar is now a separate opt-in step)", async () => {
    await UserRepository.upsertFromGoogle({
      id: "g-1",
      name: "New User",
      email: "new@squaads.com",
      image: null,
      accessToken: "identity-only-token",
    });

    expect(state.insertCalls).toHaveLength(1);
    expect(state.insertCalls[0]?.calendarEnabled).toBe(false);
  });

  it("does not touch calendarEnabled when updating an existing user", async () => {
    state.rows = [
      {
        id: "existing-1",
        email: "existing@squaads.com",
        calendarEnabled: true,
      },
    ];

    await UserRepository.upsertFromGoogle({
      id: "existing-1",
      name: "Existing User",
      email: "existing@squaads.com",
      image: null,
      accessToken: "tok",
    });

    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0]?.calendarEnabled).toBeUndefined();
  });
});
