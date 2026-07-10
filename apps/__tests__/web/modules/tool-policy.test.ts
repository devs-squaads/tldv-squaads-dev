import { afterEach, describe, expect, it } from "bun:test";

import { CHAT_TOOL_CATALOG } from "../../../web/src/integrations/chat/tools/catalog";
import { resolveChatToolPolicy } from "../../../web/src/modules/chat/policy/toolPolicy";

const ENV_KEYS = ["CHAT_TOOL_POLICY", "CHAT_ENABLE_MUTATING_TOOLS"] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const READ_ONLY_TOOLS = CHAT_TOOL_CATALOG.filter((tool) => !tool.mutates).map((tool) => tool.name);
const MUTATING_TOOLS = CHAT_TOOL_CATALOG.filter((tool) => tool.mutates).map((tool) => tool.name);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
});

describe("resolveChatToolPolicy", () => {
  it("defaults to safe read-only mode when no env is configured", () => {
    delete process.env.CHAT_TOOL_POLICY;
    delete process.env.CHAT_ENABLE_MUTATING_TOOLS;

    expect(resolveChatToolPolicy()).toEqual({
      configuredPolicy: null,
      activePolicy: "read-only",
      resolutionSource: "default",
      resolutionReason: "No explicit policy configured; defaulting to safe read-only mode",
      allowedToolNames: READ_ONLY_TOOLS,
      blockedMutatingToolNames: MUTATING_TOOLS,
      legacyMutatingToolsFlag: null,
    });
  });

  it("prefers a valid CHAT_TOOL_POLICY over the legacy mutating-tools flag", () => {
    process.env.CHAT_TOOL_POLICY = "read-only";
    process.env.CHAT_ENABLE_MUTATING_TOOLS = "true";

    expect(resolveChatToolPolicy()).toEqual({
      configuredPolicy: "read-only",
      activePolicy: "read-only",
      resolutionSource: "env",
      resolutionReason: "Resolved from CHAT_TOOL_POLICY=read-only",
      allowedToolNames: READ_ONLY_TOOLS,
      blockedMutatingToolNames: MUTATING_TOOLS,
      legacyMutatingToolsFlag: "true",
    });
  });

  for (const testCase of [
    {
      flag: "true",
      activePolicy: "full",
      allowedToolNames: CHAT_TOOL_CATALOG.map((tool) => tool.name),
      blockedMutatingToolNames: [] as string[],
    },
    {
      flag: "false",
      activePolicy: "read-only",
      allowedToolNames: READ_ONLY_TOOLS,
      blockedMutatingToolNames: MUTATING_TOOLS,
    },
  ] as const) {
    it(`supports legacy CHAT_ENABLE_MUTATING_TOOLS=${testCase.flag}`,
      () => {
      delete process.env.CHAT_TOOL_POLICY;
      process.env.CHAT_ENABLE_MUTATING_TOOLS = testCase.flag;

      expect(resolveChatToolPolicy()).toEqual({
        configuredPolicy: null,
        activePolicy: testCase.activePolicy,
        resolutionSource: "legacy-env",
        resolutionReason: `Resolved from legacy CHAT_ENABLE_MUTATING_TOOLS=${testCase.flag}`,
        allowedToolNames: testCase.allowedToolNames,
        blockedMutatingToolNames: testCase.blockedMutatingToolNames,
        legacyMutatingToolsFlag: testCase.flag,
      });
      });
  }
});
