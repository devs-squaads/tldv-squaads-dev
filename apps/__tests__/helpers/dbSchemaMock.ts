/**
 * Bun's `mock.module()` overrides a module by its resolved path for the whole
 * test process, not just the file that calls it — whichever test file's
 * `bun test` discovery order touches "drizzle-orm" / "@meeting-bot/shared/db/schema"
 * first "wins" for every other file that mocks the same specifier afterwards.
 * Every repository test that mocks these two specifiers MUST use these exact
 * superset factories, or an unrelated file can crash with a missing-export
 * SyntaxError depending on file discovery order.
 *
 * Because of this, repository test doubles must NOT filter rows by inspecting
 * what `eq()`/`asc()` return — set `state.rows` to exactly what the test needs
 * and ignore the condition argument (see AuthorizedAccountRepository.test.ts).
 */
export function mockDrizzleOrmModule() {
  return {
    eq: (...args: [unknown, unknown]) => ({ __op: "eq", value: args[1] }),
    asc: () => ({ __op: "asc" }),
    desc: () => ({ __op: "desc" }),
  };
}

export function mockDbSchemaModule() {
  return {
    users: {},
    chatMessages: {},
    settings: {},
    authorizedAccounts: {},
  };
}
