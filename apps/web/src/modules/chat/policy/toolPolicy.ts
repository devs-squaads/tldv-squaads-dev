import { CHAT_TOOL_CATALOG } from "@/integrations/chat/tools/catalog";

export type ChatToolPolicyName = "read-only" | "full";

export type ChatToolPolicySource = "default" | "env" | "legacy-env";

export interface ChatToolPolicyResolution {
  configuredPolicy: string | null;
  activePolicy: ChatToolPolicyName;
  resolutionSource: ChatToolPolicySource;
  resolutionReason: string;
  allowedToolNames: string[];
  blockedMutatingToolNames: string[];
  legacyMutatingToolsFlag: "true" | "false" | null;
}

const EXPLICIT_POLICIES: readonly ChatToolPolicyName[] = ["read-only", "full"];

function isChatToolPolicyName(value: string): value is ChatToolPolicyName {
  return (EXPLICIT_POLICIES as readonly string[]).includes(value);
}

function buildResolution(
  activePolicy: ChatToolPolicyName,
  resolutionSource: ChatToolPolicySource,
  resolutionReason: string,
  configuredPolicy: string | null,
  legacyMutatingToolsFlag: "true" | "false" | null,
): ChatToolPolicyResolution {
  const allowedToolNames = CHAT_TOOL_CATALOG
    .filter((tool) => activePolicy === "full" || !tool.mutates)
    .map((tool) => tool.name);
  const blockedMutatingToolNames = CHAT_TOOL_CATALOG
    .filter((tool) => tool.mutates && !allowedToolNames.includes(tool.name))
    .map((tool) => tool.name);

  return {
    configuredPolicy,
    activePolicy,
    resolutionSource,
    resolutionReason,
    allowedToolNames,
    blockedMutatingToolNames,
    legacyMutatingToolsFlag,
  };
}

export function resolveChatToolPolicy(): ChatToolPolicyResolution {
  const configuredPolicy = process.env.CHAT_TOOL_POLICY?.trim().toLowerCase() || null;
  const legacyMutatingToolsFlag = process.env.CHAT_ENABLE_MUTATING_TOOLS === "true"
    ? "true"
    : process.env.CHAT_ENABLE_MUTATING_TOOLS === "false"
      ? "false"
      : null;

  if (configuredPolicy) {
    if (isChatToolPolicyName(configuredPolicy)) {
      return buildResolution(
        configuredPolicy,
        "env",
        `Resolved from CHAT_TOOL_POLICY=${configuredPolicy}`,
        configuredPolicy,
        legacyMutatingToolsFlag,
      );
    }

    return buildResolution(
      "read-only",
      "default",
      `Invalid CHAT_TOOL_POLICY=${configuredPolicy}; falling back to safe default read-only`,
      configuredPolicy,
      legacyMutatingToolsFlag,
    );
  }

  if (legacyMutatingToolsFlag === "true") {
    return buildResolution(
      "full",
      "legacy-env",
      "Resolved from legacy CHAT_ENABLE_MUTATING_TOOLS=true",
      null,
      legacyMutatingToolsFlag,
    );
  }

  if (legacyMutatingToolsFlag === "false") {
    return buildResolution(
      "read-only",
      "legacy-env",
      "Resolved from legacy CHAT_ENABLE_MUTATING_TOOLS=false",
      null,
      legacyMutatingToolsFlag,
    );
  }

  return buildResolution(
    "read-only",
    "default",
    "No explicit policy configured; defaulting to safe read-only mode",
    null,
    null,
  );
}
