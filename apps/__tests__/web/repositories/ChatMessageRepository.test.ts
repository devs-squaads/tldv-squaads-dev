import { describe, expect, it, mock } from "bun:test";
import { MAX_MESSAGES } from "../../../web/src/modules/chat/http/contracts";
import { mockDrizzleOrmModule, mockDbSchemaModule } from "../../helpers/dbSchemaMock";

type PersistedRow = { role: string; content: string };

type QueryState = {
  rows: PersistedRow[];
  outerDeleteCalls: number;
  outerInsertCalls: number;
  txDeleteCalls: number;
  txInsertCalls: number;
  txInsertedValues: Array<Array<Record<string, unknown>>>;
  txDeleteOrder: number[];
  txInsertOrder: number[];
  transactionCalls: number;
  step: number;
  failInsert: Error | null;
};

const state: QueryState = {
  rows: [],
  outerDeleteCalls: 0,
  outerInsertCalls: 0,
  txDeleteCalls: 0,
  txInsertCalls: 0,
  txInsertedValues: [],
  txDeleteOrder: [],
  txInsertOrder: [],
  transactionCalls: 0,
  step: 0,
  failInsert: null,
};

function resetState() {
  state.rows = [];
  state.outerDeleteCalls = 0;
  state.outerInsertCalls = 0;
  state.txDeleteCalls = 0;
  state.txInsertCalls = 0;
  state.txInsertedValues = [];
  state.txDeleteOrder = [];
  state.txInsertOrder = [];
  state.transactionCalls = 0;
  state.step = 0;
  state.failInsert = null;
}

const selectChain = {
  from() {
    return this;
  },
  where() {
    return this;
  },
  orderBy() {
    return Promise.resolve(state.rows);
  },
};

const txMock = {
  delete() {
    return {
      where: async () => {
        state.txDeleteCalls += 1;
        state.step += 1;
        state.txDeleteOrder.push(state.step);
      },
    };
  },
  insert() {
    return {
      values: async (values: Array<Record<string, unknown>>) => {
        state.txInsertCalls += 1;
        state.step += 1;
        state.txInsertOrder.push(state.step);
        state.txInsertedValues.push(values);

        if (state.failInsert) {
          throw state.failInsert;
        }
      },
    };
  },
};

const dbMock = {
  select() {
    return selectChain;
  },
  delete() {
    state.outerDeleteCalls += 1;
    return {
      where: async () => undefined,
    };
  },
  insert() {
    state.outerInsertCalls += 1;
    return {
      values: async () => undefined,
    };
  },
  transaction: async (callback: (tx: typeof txMock) => Promise<void>) => {
    state.transactionCalls += 1;
    return callback(txMock);
  },
};

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

// These two specifiers must stay in sync with every other repository test's
// mock (see apps/__tests__/helpers/dbSchemaMock.ts) — bun's mock.module()
// resolves per process, not per file.
bunMock.module("drizzle-orm", mockDrizzleOrmModule);
bunMock.module("@meeting-bot/shared/db/schema", mockDbSchemaModule);
bunMock.module("@meeting-bot/shared/db", () => ({ db: dbMock }));

const { ChatMessageRepository } = await import("../../../web/src/repositories/ChatMessageRepository");

describe("ChatMessageRepository", () => {
  it("revalidates persisted rows on read, normalizes text, and drops invalid entries", async () => {
    resetState();
    state.rows = [
      { role: "user", content: "  hola  " },
      { role: "assistant", content: "  respuesta  " },
      { role: "system", content: "ignored" },
      { role: "user", content: "   " },
    ];

    const result = await ChatMessageRepository.findByUserId("user-1");

    expect(result).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "respuesta" },
    ]);
  });

  it("keeps the last MAX_MESSAGES valid rows in chronological order on read", async () => {
    resetState();
    const validRows = Array.from({ length: MAX_MESSAGES + 2 }, (_unused, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: ` message-${index + 1} `,
    }));

    state.rows = [
      { role: "system", content: "ignored-before-window" },
      ...validRows,
      { role: "assistant", content: "   " },
    ];

    const result = await ChatMessageRepository.findByUserId("user-1");

    expect(result.length).toBe(MAX_MESSAGES);
    expect(result[0]).toEqual({ role: "user", content: "message-3" });
    expect(result.at(-1)).toEqual({ role: "assistant", content: `message-${MAX_MESSAGES + 2}` });
  });

  it("replaceForUser trims persisted messages and writes them through a single transaction", async () => {
    resetState();

    await ChatMessageRepository.replaceForUser("user-42", [
      { role: "user", content: "  first question  " },
      { role: "assistant", content: "  second answer  " },
    ]);

    expect(state.transactionCalls).toBe(1);
    expect(state.outerDeleteCalls).toBe(0);
    expect(state.outerInsertCalls).toBe(0);
    expect(state.txDeleteCalls).toBe(1);
    expect(state.txInsertCalls).toBe(1);
    expect(state.txDeleteOrder).toEqual([1]);
    expect(state.txInsertOrder).toEqual([2]);
    expect(state.txInsertedValues.length).toBe(1);
    expect(
      state.txInsertedValues[0]?.map((row) => ({
        userId: row.userId,
        role: row.role,
        content: row.content,
      })),
    ).toEqual([
      { userId: "user-42", role: "user", content: "first question" },
      { userId: "user-42", role: "assistant", content: "second answer" },
    ]);

    const insertedRows = state.txInsertedValues[0] ?? [];
    expect(insertedRows.length).toBe(2);
    expect(insertedRows[0]?.createdAt instanceof Date).toBe(true);
    expect(insertedRows[1]?.createdAt instanceof Date).toBe(true);
    expect(
      (insertedRows[1]?.createdAt as Date).getTime() > (insertedRows[0]?.createdAt as Date).getTime(),
    ).toBe(true);
  });

  it("replaceForUser persists only the last MAX_MESSAGES valid entries and preserves their order", async () => {
    resetState();

    await ChatMessageRepository.replaceForUser(
      "user-42",
      Array.from({ length: MAX_MESSAGES + 2 }, (_unused, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: ` message-${index + 1} `,
      })),
    );

    const insertedRows = state.txInsertedValues[0] ?? [];

    expect(insertedRows.length).toBe(MAX_MESSAGES);
    expect(
      insertedRows.map((row) => ({ role: row.role, content: row.content })),
    ).toEqual(
      Array.from({ length: MAX_MESSAGES }, (_unused, index) => ({
        role: (index + 2) % 2 === 0 ? "user" : "assistant",
        content: `message-${index + 3}`,
      })),
    );
  });

  it("replaceForUser keeps a consistent empty replacement by deleting inside the transaction without inserting", async () => {
    resetState();

    await ChatMessageRepository.replaceForUser("user-42", []);

    expect(state.transactionCalls).toBe(1);
    expect(state.txDeleteCalls).toBe(1);
    expect(state.txInsertCalls).toBe(0);
    expect(state.txDeleteOrder).toEqual([1]);
    expect(state.txInsertedValues.length).toBe(0);
  });

  it("rejects invalid roles or empty contents before opening the replacement transaction", async () => {
    resetState();

    await expect(
      ChatMessageRepository.replaceForUser("user-42", [
        { role: "system" as "user", content: "not allowed" },
      ]),
    ).rejects.toThrow("Invalid message role or content");

    expect(state.transactionCalls).toBe(0);
    expect(state.txDeleteCalls).toBe(0);
    expect(state.txInsertCalls).toBe(0);
  });

  it("still performs a consistent replacement contract when insert fails inside the transaction", async () => {
    resetState();
    state.failInsert = new Error("insert failed");

    await expect(
      ChatMessageRepository.replaceForUser("user-42", [
        { role: "user", content: "hello" },
      ]),
    ).rejects.toThrow("insert failed");

    expect(state.transactionCalls).toBe(1);
    expect(state.outerDeleteCalls).toBe(0);
    expect(state.outerInsertCalls).toBe(0);
    expect(state.txDeleteCalls).toBe(1);
    expect(state.txInsertCalls).toBe(1);
    expect(state.txDeleteOrder).toEqual([1]);
    expect(state.txInsertOrder).toEqual([2]);
  });
});
