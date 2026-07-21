import { describe, expect, it, mock, beforeEach } from "bun:test";
import { mockDrizzleOrmModule, mockDbSchemaModule } from "../../helpers/dbSchemaMock";

type UserRow = { id: string; email: string };

const state: { rows: UserRow[] } = { rows: [] };

function resetState() {
  state.rows = [];
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
};

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

// These two specifiers must stay in sync with every other repository test's
// mock — bun's mock.module() resolves per process, not per file.
bunMock.module("drizzle-orm", mockDrizzleOrmModule);
bunMock.module("@meeting-bot/shared/db/schema", mockDbSchemaModule);
bunMock.module("@meeting-bot/shared/db", () => ({ db: dbMock }));

const { UserRepository } = await import("../../../../packages/shared/src/repositories/UserRepository");

describe("UserRepository.findByEmail", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns null when no user matches the email (machine-to-machine ownerEmail resolution miss)", async () => {
    const result = await UserRepository.findByEmail("nobody@squaads.com");
    expect(result).toBeNull();
  });

  it("returns the matching user's id and email when one exists", async () => {
    state.rows = [{ id: "user-1", email: "owner@squaads.com" }];

    const result = await UserRepository.findByEmail("owner@squaads.com");
    expect(result?.id).toBe("user-1");
    expect(result?.email).toBe("owner@squaads.com");
  });
});
