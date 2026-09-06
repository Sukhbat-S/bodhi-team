export type CompatibilityOwner = "codex" | "bodhi";

export interface DeprecatedToolReplacement {
  owner: CompatibilityOwner;
  capability: string;
  tool?: string;
}

/**
 * One-release compatibility response for MCP capabilities that moved upstream.
 * Deprecated tools remain discoverable, but they must not call their legacy
 * HTTP endpoints or mutate retired state.
 */
export function deprecatedToolResponse(
  tool: string,
  replacement: DeprecatedToolReplacement,
  reason: string,
): string {
  return JSON.stringify(
    {
      status: "deprecated",
      compatibilityRelease: "1.0",
      tool,
      replacement,
      reason,
    },
    null,
    2,
  );
}
