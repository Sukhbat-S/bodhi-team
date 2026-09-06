// ============================================================
// BODHI MCP Server — per-call tool context (Wave D, Jun 10 2026)
//
// AsyncLocalStorage carrying the currently-executing MCP tool name.
// registerTool is wrapped once in index.ts so every handler runs
// inside `toolContext.run({ tool: name }, ...)`; bodhiFetch() reads
// the store and attaches `X-BODHI-Tool` to each request, letting the
// server's mcp_call middleware record WHICH tool fired (the blind
// spot that made pane-tools look dead in telemetry).
// ============================================================

import { AsyncLocalStorage } from "node:async_hooks";

export const toolContext = new AsyncLocalStorage<{ tool: string }>();

/** Name of the MCP tool whose handler is currently executing, if any. */
export function currentToolName(): string | undefined {
  return toolContext.getStore()?.tool;
}
