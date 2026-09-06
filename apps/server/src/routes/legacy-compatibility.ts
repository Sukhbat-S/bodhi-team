import type { Context, Hono } from "hono";

export type LegacyCapability =
  | "active-session-coordination"
  | "terminal-orchestration"
  | "conversation-ingestion"
  | "plans"
  | "dispatch-telemetry"
  | "next-action-orchestration"
  | "activity-digest"
  | "headless-code-execution"
  | "architect-attention-inbox"
  | "model-memory-extraction"
  | "briefings";

const REPLACEMENTS: Record<LegacyCapability, { owner: "codex"; surface: string; checkpointApi?: string }> = {
  "active-session-coordination": {
    owner: "codex",
    surface: "Codex Desktop tasks, Activity, and managed worktrees",
    checkpointApi: "/api/checkpoints",
  },
  "terminal-orchestration": {
    owner: "codex",
    surface: "Codex Desktop task execution and managed worktrees",
    checkpointApi: "/api/checkpoints",
  },
  "conversation-ingestion": {
    owner: "codex",
    surface: "native Codex task history",
    checkpointApi: "/api/checkpoints",
  },
  plans: {
    owner: "codex",
    surface: "the active Codex task",
    checkpointApi: "/api/checkpoints",
  },
  "dispatch-telemetry": {
    owner: "codex",
    surface: "Codex Activity and checkpoint verification receipts",
    checkpointApi: "/api/checkpoints",
  },
  "next-action-orchestration": {
    owner: "codex",
    surface: "Codex Activity",
    checkpointApi: "/api/checkpoints",
  },
  "activity-digest": {
    owner: "codex",
    surface: "Codex Activity and native notifications",
  },
  "headless-code-execution": {
    owner: "codex",
    surface: "Codex Desktop tasks and managed worktrees",
    checkpointApi: "/api/checkpoints",
  },
  "architect-attention-inbox": {
    owner: "codex",
    surface: "Codex Activity, native notifications, and session-start handoff",
    checkpointApi: "/api/checkpoints",
  },
  "model-memory-extraction": {
    owner: "codex",
    surface: "session-save for reviewed durable decisions and unresolved items",
    checkpointApi: "/api/checkpoints",
  },
  briefings: {
    owner: "codex",
    surface: "native Codex Desktop scheduled tasks and Activity",
  },
};

export function gone(c: Context, capability: LegacyCapability) {
  return c.json({
    error: "gone",
    code: "BODHI_CAPABILITY_RETIRED",
    capability,
    lifecycle: "read-only-compatibility",
    replacement: REPLACEMENTS[capability],
    archive: {
      status: "preserved",
      tablesDropped: false,
      note: "Historical rows remain available through the verified legacy archive bundle.",
    },
  }, 410);
}

/**
 * One-release compatibility boundary for capabilities now owned by Codex.
 * Every method returns 410, which prevents both accidental writes and stale
 * clients mistaking archived data for live operating state.
 */
export function mountLegacyCompatibilityRoutes(app: Hono): Hono {
  const mountFamily = (base: string, capability: LegacyCapability) => {
    app.all(base, (c) => gone(c, capability));
    app.all(`${base}/*`, (c) => gone(c, capability));
  };

  mountFamily("/api/sessions", "active-session-coordination");
  mountFamily("/api/terminals", "terminal-orchestration");
  mountFamily("/api/conversations", "conversation-ingestion");
  mountFamily("/api/plans", "plans");
  mountFamily("/api/agent-dispatches", "dispatch-telemetry");
  mountFamily("/api/subagents", "dispatch-telemetry");

  app.all("/api/agents/dispatch-stats", (c) => gone(c, "dispatch-telemetry"));
  app.all("/api/agents/l1-violations", (c) => gone(c, "dispatch-telemetry"));
  app.all("/api/agents/index", (c) => gone(c, "dispatch-telemetry"));
  app.all("/api/skills/record-invocation", (c) => gone(c, "dispatch-telemetry"));
  app.all("/api/turns/record", (c) => gone(c, "dispatch-telemetry"));
  app.all("/api/suggest-next-action", (c) => gone(c, "next-action-orchestration"));
  app.all("/api/daily-digest", (c) => gone(c, "activity-digest"));
  mountFamily("/api/code", "headless-code-execution");
  mountFamily("/api/architect-inbox", "architect-attention-inbox");
  app.all("/api/memories/extract", (c) => gone(c, "model-memory-extraction"));
  mountFamily("/api/briefings", "briefings");

  return app;
}
