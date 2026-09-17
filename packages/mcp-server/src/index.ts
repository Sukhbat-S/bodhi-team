#!/usr/bin/env node

import "./load-env.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { toolContext } from "./tool-context.js";
import {
  attachCheckpointArtifact,
  completeCheckpoint,
  correctMemory,
  findCheckpoints,
  forgetMemory,
  getCheckpoint,
  getSubstrateStatus,
  getPolicyPacket,
  getProjectContext,
  librarySearch,
  listParked,
  lookupEntities,
  listGoals,
  listOpportunities,
  parkItem,
  recordCheckpointVerification,
  recordGoalReview,
  proposeOpportunity,
  resolveOpportunity,
  saveGoal,
  saveCheckpoint,
  searchMemories,
  storeMemory,
  storeSessionSummary,
} from "./client.js";

const stringArray = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim().startsWith("[")) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}, z.array(z.string()));

const server = new McpServer({ name: "bodhi", version: "1.0.0" });
{
  const original = server.registerTool.bind(server);
  const wrapped = (name: string, config: unknown, handler: (...args: unknown[]) => unknown) =>
    (original as unknown as (n: string, c: unknown, h: unknown) => unknown)(
      name,
      config,
      (...args: unknown[]) => toolContext.run({ tool: name }, () => handler(...args)),
    );
  server.registerTool = wrapped as unknown as typeof server.registerTool;
}

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });
const metadataSchema = z.object({}).passthrough();
const directionEvidenceSchema = z.object({
  sourceKind: z.enum(["file", "goal", "checkpoint", "memory", "parking", "verification", "activity", "other"]),
  reference: z.string(),
  observedAt: z.string(),
  sha256: z.string(),
  summary: z.string(),
});
const observationScopeSchema = z.object({
  kind: z.enum(["project", "path"]),
  ref: z.string(),
  purpose: z.string(),
});

server.registerTool("search_memories", {
  description: "Search confirmed personal memories. Treat results as stored testimony and corroborate them when current code or external facts matter.",
  inputSchema: {
    query: z.string(),
    limit: z.coerce.number().min(1).max(50).optional().default(10),
    project: z.string().optional(),
  },
}, async ({ query, limit, project }) => textResult(await searchMemories(query, limit, project)));

server.registerTool("library_search", {
  description: "Optionally retrieve from BODHI's reference library. Retrieval is recorded separately from actual citation. The corpus may be stale; never use it as the sole authority for a current claim.",
  inputSchema: {
    query: z.string(),
    domain: z.string().optional(),
    sub_domain: z.string().optional(),
    limit: z.coerce.number().min(1).max(25).optional().default(5),
  },
}, async ({ query, domain, sub_domain, limit }) => textResult(await librarySearch({ query, domain, sub_domain, limit })));

server.registerTool("lookup_entities", {
  description: "Look up canonical people, projects, organizations, places, and topics.",
  inputSchema: {
    query: z.string().optional(),
    type: z.enum(["person", "project", "organization", "place", "topic"]).optional(),
    limit: z.coerce.number().min(1).max(50).optional().default(10),
  },
}, async ({ query, type, limit }) => textResult(await lookupEntities({ query, type, limit })));

server.registerTool("save_goal", {
  description: "Create an explicitly directed structured goal, or update one by exact UUID. Never promote a goal memory automatically.",
  inputSchema: {
    goal_id: z.string().uuid().optional(),
    project_key: z.string().optional(),
    title: z.string().optional(),
    outcome: z.string().optional(),
    success_criteria: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    priority: z.coerce.number().int().min(1).max(5).optional(),
    status: z.enum(["active", "paused", "completed", "abandoned"]).optional(),
    target_date: z.string().nullable().optional(),
    observation_scopes: z.array(observationScopeSchema).optional(),
  },
}, async (input) => textResult(await saveGoal({
  goalId: input.goal_id,
  projectKey: input.project_key,
  title: input.title,
  outcome: input.outcome,
  successCriteria: input.success_criteria,
  constraints: input.constraints,
  priority: input.priority,
  status: input.status,
  targetDate: input.target_date,
  observationScopes: input.observation_scopes,
})));

server.registerTool("list_goals", {
  description: "List structured goals and rolling weekly or quarterly review-due state.",
  inputSchema: {
    project: z.string().optional(),
    status: z.enum(["active", "paused", "completed", "abandoned"]).optional(),
    review_due: z.enum(["weekly", "quarterly"]).optional(),
    goal_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  },
}, async (input) => textResult(await listGoals({
  project: input.project, status: input.status, reviewDue: input.review_due,
  goalId: input.goal_id, limit: input.limit,
})));

server.registerTool("record_goal_review", {
  description: "Record a weekly or quarterly assessment for one exact structured goal.",
  inputSchema: {
    goal_id: z.string().uuid(),
    cadence: z.enum(["weekly", "quarterly"]),
    assessment: z.enum(["on-track", "at-risk", "blocked", "complete"]),
    evidence: z.array(directionEvidenceSchema).optional(),
    decisions: z.array(z.string()).optional(),
    next_actions: z.array(z.string()).optional(),
    reviewed_at: z.string().optional(),
  },
}, async (input) => textResult(await recordGoalReview(input.goal_id, {
  cadence: input.cadence, assessment: input.assessment, evidence: input.evidence,
  decisions: input.decisions, nextActions: input.next_actions, reviewedAt: input.reviewed_at,
})));

server.registerTool("propose_opportunity", {
  description: "Store an evidence-backed read-only proposal. This never authorizes or starts execution.",
  inputSchema: {
    project_key: z.string(),
    goal_id: z.string().uuid().nullable().optional(),
    title: z.string(),
    observation: z.string(),
    why_now: z.string(),
    proposed_action: z.string(),
    expected_value: z.enum(["low", "medium", "high"]),
    risk: z.enum(["low", "medium", "high"]),
    action_class: z.string().nullable().optional(),
    approval_required: z.boolean().optional().default(true),
    evidence: z.array(directionEvidenceSchema).optional(),
  },
}, async (input) => textResult(await proposeOpportunity({
  projectKey: input.project_key, goalId: input.goal_id, title: input.title,
  observation: input.observation, whyNow: input.why_now, proposedAction: input.proposed_action,
  expectedValue: input.expected_value, risk: input.risk, actionClass: input.action_class,
  approvalRequired: input.approval_required, evidence: input.evidence,
})));

server.registerTool("list_opportunities", {
  description: "List evidence-backed opportunities without executing them.",
  inputSchema: {
    project: z.string().optional(),
    status: z.enum(["open", "accepted", "in_progress", "parked", "dismissed", "completed"]).optional(),
    goal_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  },
}, async (input) => textResult(await listOpportunities({
  project: input.project, status: input.status, goalId: input.goal_id, limit: input.limit,
})));

server.registerTool("resolve_opportunity", {
  description: "Accept, dismiss, or park one exact opportunity. Accepting records intent only and dispatches nothing.",
  inputSchema: {
    opportunity_id: z.string().uuid(),
    action: z.enum(["accept", "dismiss", "park"]),
    reason: z.string().optional(),
    parked_item_id: z.string().optional(),
  },
}, async (input) => textResult(await resolveOpportunity(input.opportunity_id, {
  action: input.action, reason: input.reason, parkedItemId: input.parked_item_id,
})));

const checkpointDecisionSchema = z.object({
  text: z.string(),
  madeAt: z.string().optional(),
  rationale: z.string().optional(),
});
const checkpointNextActionSchema = z.object({
  text: z.string(),
  status: z.enum(["pending", "done", "dropped"]).optional(),
  owner: z.string().optional(),
});

server.registerTool("save_checkpoint", {
  description: "Create, update, or explicitly select an independent durable outcome by checkpoint UUID. Plain provider lookup never chooses among multiple outcomes.",
  inputSchema: {
    mode: z.enum(["create", "update", "select"]).optional(),
    checkpoint_id: z.string().uuid().optional(),
    expected_content_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    expected_current_checkpoint_id: z.string().uuid().nullable().optional(),
    project_key: z.string(),
    objective: z.string().optional(),
    summary: z.string().optional(),
    state: z.enum(["active", "paused", "abandoned"]).optional(),
    decisions: z.array(checkpointDecisionSchema).optional(),
    next_actions: z.array(checkpointNextActionSchema).optional(),
    entity_ids: stringArray.optional(),
    parent_checkpoint_id: z.string().nullable().optional(),
    goal_id: z.string().nullable().optional(),
    opportunity_id: z.string().nullable().optional(),
    pattern_key: z.string().nullable().optional(),
    provider: z.string().default("codex"),
    provider_task_id: z.string(),
    host_id: z.string().nullable().optional(),
    working_directory: z.string().nullable().optional(),
    task_url: z.string().nullable().optional(),
    is_primary: z.boolean().optional().default(true),
  },
}, async (input) => textResult(await saveCheckpoint({
  mode: input.mode,
  checkpointId: input.checkpoint_id,
  expectedContentHash: input.expected_content_hash,
  expectedCurrentCheckpointId: input.expected_current_checkpoint_id,
  projectKey: input.project_key,
  objective: input.objective,
  summary: input.summary,
  state: input.state,
  decisions: input.decisions,
  nextActions: input.next_actions,
  entityIds: input.entity_ids,
  parentCheckpointId: input.parent_checkpoint_id,
  goalId: input.goal_id,
  opportunityId: input.opportunity_id,
  patternKey: input.pattern_key,
  providerRef: {
    provider: input.provider,
    nativeTaskId: input.provider_task_id,
    hostId: input.host_id,
    workingDirectory: input.working_directory,
    taskUrl: input.task_url,
    isPrimary: input.is_primary,
  },
})));

server.registerTool("get_checkpoint", {
  description: "Get an exact checkpoint or an explicitly selected current outcome. Ambiguous provider lookup fails. effectiveVerification is current evidence; completionVerificationState is immutable history.",
  inputSchema: {
    checkpoint_id: z.string().optional(),
    provider: z.string().optional(),
    provider_task_id: z.string().optional(),
    project_key: z.string().optional(),
    selection: z.literal("current").optional(),
  },
}, async ({ checkpoint_id, provider, provider_task_id, project_key, selection }) => {
  if (!checkpoint_id && !(provider && provider_task_id)) {
    return { ...textResult("Provide checkpoint_id or provider plus provider_task_id."), isError: true };
  }
  return textResult(checkpoint_id
    ? await getCheckpoint(checkpoint_id)
    : await getCheckpoint(provider_task_id!, provider, project_key, selection));
});

server.registerTool("find_checkpoints", {
  description: "Find durable checkpoint outcomes by project, state, objective, entity, or provider identity. Use effectiveVerification for current evidence; historical completionVerificationState alone is insufficient.",
  inputSchema: {
    project: z.string().optional(),
    state: z.enum(["active", "paused", "completed", "abandoned"]).optional(),
    objective: z.string().optional(),
    entity: z.string().optional(),
    provider: z.string().optional(),
    provider_task_id: z.string().optional(),
    since: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
  },
}, async (input) => textResult(await findCheckpoints({
  project: input.project,
  state: input.state,
  objective: input.objective,
  entity: input.entity,
  provider: input.provider,
  providerTaskId: input.provider_task_id,
  since: input.since,
  limit: input.limit,
})));

server.registerTool("attach_artifact", {
  description: "Attach a durable artifact to a checkpoint.",
  inputSchema: {
    checkpoint_id: z.string(),
    artifact_type: z.string(),
    uri: z.string(),
    label: z.string().nullable().optional(),
    sha256: z.string().nullable().optional(),
    metadata: metadataSchema.optional(),
  },
}, async (input) => textResult(await attachCheckpointArtifact(input.checkpoint_id, {
  artifactType: input.artifact_type,
  uri: input.uri,
  label: input.label,
  sha256: input.sha256,
  metadata: input.metadata,
})));

server.registerTool("record_verification", {
  description: "Append an immutable verification receipt. Correlate an exact subject SHA-256 through receipt/root UUIDs and explicit predecessor links; unrelated checks never supersede one another.",
  inputSchema: {
    checkpoint_id: z.string(),
    receipt_id: z.string().uuid().optional(),
    claim_receipt_id: z.string().uuid().optional(),
    subject_revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    supersedes_receipt_id: z.string().uuid().optional(),
    claim: z.string(),
    expected_signal: z.string(),
    observed_signal: z.string().nullable().optional(),
    evidence_source: z.string(),
    status: z.enum(["pending", "passed", "failed"]).optional().default("pending"),
    observed_at: z.string().optional(),
    metadata: metadataSchema.optional(),
  },
}, async (input) => textResult(await recordCheckpointVerification(input.checkpoint_id, {
  receiptId: input.receipt_id,
  claimReceiptId: input.claim_receipt_id,
  subjectRevision: input.subject_revision,
  supersedesReceiptId: input.supersedes_receipt_id,
  claim: input.claim,
  expectedSignal: input.expected_signal,
  observedSignal: input.observed_signal,
  evidenceSource: input.evidence_source,
  status: input.status,
  observedAt: input.observed_at,
  metadata: input.metadata,
})));

server.registerTool("complete_checkpoint", {
  description: "Complete an exact outcome with an explicit frozen list of current receipt heads and remaining-work disposition. v3 outcomes require completion_receipt_ids; terminal history is immutable.",
  inputSchema: {
    checkpoint_id: z.string(),
    summary: z.string(),
    remaining_work_disposition: z.enum(["none", "deferred", "abandoned"]),
    verification_state: z.enum(["passed", "failed", "not-required"]),
    completion_receipt_ids: z.array(z.string().uuid()).max(1000).optional(),
    outcome_metrics: z.object({
      resultDisposition: z.enum(["accepted", "revised", "discarded"]),
      reviewMinutes: z.coerce.number().int().min(0).optional(),
      reworkCount: z.coerce.number().int().min(0).optional(),
      completedWorkerOutcomes: z.coerce.number().int().min(0).optional(),
      computeCostUsd: z.coerce.number().min(0).optional(),
    }).nullable().optional(),
  },
}, async (input) => textResult(await completeCheckpoint(input.checkpoint_id, {
  summary: input.summary,
  remainingWorkDisposition: input.remaining_work_disposition,
  verificationState: input.verification_state,
  completionReceiptIds: input.completion_receipt_ids,
  outcomeMetrics: input.outcome_metrics,
})));

server.registerTool("store_memory", {
  description: "Store an explicit, reviewed durable memory. Do not use for routine transcript exhaust.",
  inputSchema: {
    content: z.string(),
    type: z.enum(["fact", "decision", "pattern", "preference", "event", "goal"]).optional().default("fact"),
    importance: z.coerce.number().min(0).max(1).optional().default(0.7),
    tags: stringArray.optional(),
    project: z.string().optional(),
    scope: z.enum(["foundational", "session-active", "archived"]).optional(),
  },
}, async (input) => textResult(await storeMemory(input)));

server.registerTool("forget_memory", {
  description: "Soft-forget one incorrect or no-longer-valid memory by UUID. Requires a reviewed reason and preserves an audit trail.",
  inputSchema: {
    memory_id: z.string().uuid(),
    reason: z.string().min(3).max(500),
  },
}, async ({ memory_id, reason }) => textResult(await forgetMemory(memory_id, reason)));

server.registerTool("correct_memory", {
  description: "Atomically supersede one incorrect memory with a reviewed replacement. Never use this to rewrite inferred or ambiguous transcript content as fact.",
  inputSchema: {
    memory_id: z.string().uuid(),
    content: z.string().min(1).max(20_000),
    reason: z.string().min(3).max(500),
    type: z.enum(["fact", "decision", "pattern", "preference", "event", "goal"]).optional(),
    importance: z.coerce.number().min(0).max(1).optional(),
    tags: stringArray.optional(),
    scope: z.enum(["foundational", "session-active", "archived"]).optional(),
  },
}, async (input) => textResult(await correctMemory({
  memoryId: input.memory_id,
  content: input.content,
  reason: input.reason,
  type: input.type,
  importance: input.importance,
  tags: input.tags,
  scope: input.scope,
})));

server.registerTool("store_session_summary", {
  description: "Store reviewed session outcomes and durable memories in one batch.",
  inputSchema: {
    project: z.string(),
    completed: stringArray,
    pending: stringArray,
    memories: z.array(z.object({
      content: z.string(),
      type: z.enum(["fact", "decision", "pattern", "preference", "event"]),
      importance: z.coerce.number().min(0).max(1),
      tags: stringArray.optional(),
    })),
    sessionNote: z.string().optional(),
    entityHints: z.array(z.object({
      name: z.string(),
      type: z.enum(["person", "project", "topic", "organization", "place"]),
      subtype: z.string().nullable().optional(),
    })).optional(),
  },
}, async (input) => textResult(await storeSessionSummary(input)));

server.registerTool("get_project_context", {
  description: "Get confirmed memories tagged to a project. Verify time-sensitive claims against current evidence.",
  inputSchema: {
    project: z.string(),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
  },
}, async ({ project, limit }) => textResult(await getProjectContext(project, limit)));

server.registerTool("get_policy_packet", {
  description: "Get current trust tiers and reviewed durable preferences for this task.",
  inputSchema: {
    project: z.string().optional(),
    cwd: z.string().optional(),
  },
}, async ({ project, cwd }) => textResult(await getPolicyPacket({ project, cwd })));

server.registerTool("get_substrate_status", {
  description: "Return the versioned safe substrate, reasoning, memory, scheduler, maintenance, and capability projection without owner, path, credential, release, scheduler-detail, or task-state data.",
  inputSchema: {},
}, async () => textResult(await getSubstrateStatus()));

server.registerTool("park_item", {
  description: "Park a deferred item with an executable date boundary or scheduled manual review. Richer conditions belong in detail unless an explicitly authorized native Codex monitor owns them; BODHI never auto-closes parked items.",
  inputSchema: {
    title: z.string(),
    detail: z.string().optional(),
    origin_kind: z.enum(["memory", "cron", "free"]).optional(),
    origin_ref: z.string().optional(),
    trigger: z.discriminatedUnion("type", [
      z.object({ type: z.literal("date"), on: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/) }),
      z.object({ type: z.literal("manual") }),
    ]),
    review_by: z.string().optional(),
  },
}, async (input) => textResult(await parkItem({
  title: input.title,
  detail: input.detail,
  originKind: input.origin_kind,
  originRef: input.origin_ref,
  trigger: input.trigger,
  reviewBy: input.review_by,
})));

server.registerTool("list_parked", {
  description: "List deferred items with executable-state labels. Historical event, activity, state, and auto-close JSON remains readable as non-executable descriptive intent.",
  inputSchema: { status: z.enum(["parked", "resurfaced", "closed"]).optional() },
}, async ({ status }) => textResult(await listParked({ status })));

async function main() {
  await server.connect(new StdioServerTransport());
  // Count from the live registry so this banner cannot drift from the catalog again (it said 30 after the 2026-09-12 retirement to 24).
  const registered = Object.keys((server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {}).length;
  console.error(`[bodhi-mcp] Pure-substrate server started${registered > 0 ? ` (${registered} tools)` : ""}`);
}

main().catch((error) => {
  console.error("[bodhi-mcp] Fatal error:", error);
  process.exit(1);
});
