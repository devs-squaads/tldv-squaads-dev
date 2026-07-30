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

const GOOGLE_TOKEN_COLUMNS = ["googleAccessToken", "googleRefreshToken", "googleTokenExpiry"] as const;

// Returns the leaked column names (not a boolean) so a failure says WHICH one
// was written instead of just "expected true".
function googleTokenColumnsIn(row: Record<string, unknown> | undefined): string[] {
  return GOOGLE_TOKEN_COLUMNS.filter((column) => column in (row ?? {}));
}

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

  // The google_* token columns belong to the calendar-connect flow, which is the
  // only grant carrying calendar.readonly. Login only ever holds an identity
  // token (openid/email/profile), so persisting it here silently downgraded the
  // stored grant and broke calendar polling with 403 insufficient_scope.
  it("does not write the Google token columns when creating a user", async () => {
    await UserRepository.upsertFromGoogle({
      id: "g-1",
      name: "New User",
      email: "new@squaads.com",
      image: null,
      accessToken: "identity-only-token",
      refreshToken: "identity-only-refresh",
      expiresAt: 1_700_000_000,
    });

    expect(state.insertCalls).toHaveLength(1);
    expect(googleTokenColumnsIn(state.insertCalls[0])).toEqual([]);
  });

  it("does not overwrite the calendar tokens when a returning user logs in", async () => {
    state.rows = [{ id: "existing-1", email: "existing@squaads.com" }];

    await UserRepository.upsertFromGoogle({
      id: "existing-1",
      name: "Existing User",
      email: "existing@squaads.com",
      image: null,
      accessToken: "identity-only-token",
      refreshToken: "identity-only-refresh",
      expiresAt: 1_700_000_000,
    });

    expect(state.updateCalls).toHaveLength(1);
    expect(googleTokenColumnsIn(state.updateCalls[0])).toEqual([]);
  });

  it("still refreshes the identity profile fields on every login", async () => {
    state.rows = [{ id: "existing-1", email: "existing@squaads.com" }];

    await UserRepository.upsertFromGoogle({
      id: "existing-1",
      name: "Renamed User",
      email: "existing@squaads.com",
      image: "https://example.test/avatar.png",
      accessToken: "tok",
    });

    expect(state.updateCalls[0]).toMatchObject({
      name: "Renamed User",
      image: "https://example.test/avatar.png",
    });
    expect(state.updateCalls[0]?.updatedAt).toBeInstanceOf(Date);
  });
});
