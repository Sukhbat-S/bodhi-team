import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type {
  Database,
  DirectionEvidence,
  GoalAssessment,
  GoalReviewCadence,
  ObservationScope,
  OpportunityStatus,
  PersonalGoalStatus,
  WorkflowCandidateStatus,
} from "@seneca/db";
import { canonicalizeCheckpointProjectKey } from "./checkpoints.js";
import { isEffectivelyPassed, readEffectiveCompletion } from "./checkpoint-verification.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const PATTERN_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const ACTIVE_OPPORTUNITY_STATES: OpportunityStatus[] = ["open", "accepted", "in_progress", "parked"];

export class DirectionValidationError extends Error {}
export class DirectionNotFoundError extends Error {}
export class DirectionConflictError extends Error {}

export interface SaveGoalInput {
  projectKey: string;
  title: string;
  outcome: string;
  successCriteria?: string[];
  constraints?: string[];
  priority?: number;
  status?: PersonalGoalStatus;
  targetDate?: string | null;
  observationScopes?: ObservationScope[];
}

export interface UpdateGoalInput extends Partial<Omit<SaveGoalInput, "projectKey">> {}

export interface GoalReviewInput {
  cadence: GoalReviewCadence;
  assessment: GoalAssessment;
  evidence?: DirectionEvidence[];
  decisions?: string[];
  nextActions?: string[];
  reviewedAt?: string;
}

export interface ProposeOpportunityInput {
  projectKey: string;
  goalId?: string | null;
  title: string;
  observation: string;
  whyNow: string;
  proposedAction: string;
  expectedValue: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  actionClass?: string | null;
  approvalRequired?: boolean;
  evidence?: DirectionEvidence[];
}

export type OpportunityResolution =
  | { action: "accept"; reason?: string }
  | { action: "dismiss"; reason: string }
  | { action: "park"; reason?: string; parkedItemId: string };

export type WorkflowCandidateResolution =
  | { action: "approve"; reason?: string }
  | { action: "dismiss"; reason: string }
  | { action: "materialize"; reason?: string; checkpointId: string };

export interface PersonalDirectionService {
  createGoal(input: SaveGoalInput): Promise<Record<string, unknown>>;
  updateGoal(id: string, input: UpdateGoalInput): Promise<Record<string, unknown>>;
  listGoals(input?: { project?: string; status?: PersonalGoalStatus; reviewDue?: GoalReviewCadence; goalId?: string; limit?: number }): Promise<Record<string, unknown>[]>;
  listGoalPage(input?: { project?: string; status?: PersonalGoalStatus; reviewDue?: GoalReviewCadence; goalId?: string; limit?: number }): Promise<{ goals: Record<string, unknown>[]; total: number }>;
  recordGoalReview(id: string, input: GoalReviewInput): Promise<Record<string, unknown>>;
  proposeOpportunity(input: ProposeOpportunityInput): Promise<{ opportunity: Record<string, unknown>; deduped: boolean }>;
  listOpportunities(input?: { project?: string; status?: OpportunityStatus; goalId?: string; limit?: number }): Promise<Record<string, unknown>[]>;
  resolveOpportunity(id: string, input: OpportunityResolution): Promise<Record<string, unknown>>;
  listWorkflowCandidates(input?: { project?: string; status?: WorkflowCandidateStatus; limit?: number }): Promise<Record<string, unknown>[]>;
  resolveWorkflowCandidate(id: string, input: WorkflowCandidateResolution): Promise<Record<string, unknown>>;
}

function requiredText(value: unknown, field: string, max = 20_000): string {
  if (typeof value !== "string" || !value.trim()) throw new DirectionValidationError(`${field} is required`);
  if (value.trim().length > max) throw new DirectionValidationError(`${field} exceeds ${max} characters`);
  return value.trim();
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new DirectionValidationError(`${field} must be a string`);
  if (value.trim().length > max) throw new DirectionValidationError(`${field} exceeds ${max} characters`);
  return value.trim();
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new DirectionValidationError(`${field} must be a UUID`);
  return value.toLowerCase();
}

function dateOrNull(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new DirectionValidationError(`${field} must be an ISO date`);
  }
  return new Date(value).toISOString();
}

function stringList(value: unknown, field: string, maxItems = 50, maxItem = 2_000): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new DirectionValidationError(`${field} must be an array of at most ${maxItems} items`);
  }
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxItem));
}

export function normalizeObservationScopes(value: unknown): ObservationScope[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    throw new DirectionValidationError("observationScopes must be an array of at most 50 items");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new DirectionValidationError(`observationScopes[${index}] must be an object`);
    }
    const scope = item as Record<string, unknown>;
    if (scope.kind !== "project" && scope.kind !== "path") {
      throw new DirectionValidationError(`observationScopes[${index}].kind is invalid`);
    }
    const ref = requiredText(scope.ref, `observationScopes[${index}].ref`, 4_000);
    if (scope.kind === "project") {
      if (isAbsolute(ref) || ref.split(/[\\/]/).includes("..")) {
        throw new DirectionValidationError(`observationScopes[${index}].ref must be project-relative without .. segments`);
      }
    } else if (!isAbsolute(ref)) {
      throw new DirectionValidationError(`observationScopes[${index}].ref must be an absolute path`);
    }
    return {
      kind: scope.kind,
      ref,
      purpose: requiredText(scope.purpose, `observationScopes[${index}].purpose`, 1_000),
    };
  });
}

export function normalizeDirectionEvidence(value: unknown): DirectionEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new DirectionValidationError("evidence must be an array of at most 100 items");
  }
  const kinds = ["file", "goal", "checkpoint", "memory", "parking", "verification", "activity", "other"];
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new DirectionValidationError(`evidence[${index}] must be an object`);
    }
    const evidence = item as Record<string, unknown>;
    if (!kinds.includes(String(evidence.sourceKind))) {
      throw new DirectionValidationError(`evidence[${index}].sourceKind is invalid`);
    }
    const observedAt = dateOrNull(evidence.observedAt, `evidence[${index}].observedAt`);
    if (!observedAt) throw new DirectionValidationError(`evidence[${index}].observedAt is required`);
    const sha256 = requiredText(evidence.sha256, `evidence[${index}].sha256`, 64).toLowerCase();
    if (!SHA256_RE.test(sha256)) {
      throw new DirectionValidationError(`evidence[${index}].sha256 must be 64 hexadecimal characters`);
    }
    return {
      sourceKind: evidence.sourceKind as DirectionEvidence["sourceKind"],
      reference: requiredText(evidence.reference, `evidence[${index}].reference`, 4_000),
      observedAt,
      sha256,
      summary: requiredText(evidence.summary, `evidence[${index}].summary`, 2_000),
    };
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
  }
  return value;
}

export function hashOpportunity(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex");
}

const SELECT_GOAL = sql`
  id, project_key AS "projectKey", title, outcome,
  success_criteria AS "successCriteria", constraints, priority, status,
  target_date AS "targetDate", observation_scopes AS "observationScopes",
  last_weekly_review_at AS "lastWeeklyReviewAt",
  last_quarterly_review_at AS "lastQuarterlyReviewAt",
  created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt",
  CASE WHEN status = 'active' THEN COALESCE(last_weekly_review_at, created_at) + interval '7 days' END AS "nextWeeklyReviewAt",
  CASE WHEN status = 'active' THEN COALESCE(last_quarterly_review_at, created_at) + interval '3 months' END AS "nextQuarterlyReviewAt",
  (status = 'active' AND COALESCE(last_weekly_review_at, created_at) <= now() - interval '7 days') AS "weeklyReviewDue",
  (status = 'active' AND COALESCE(last_quarterly_review_at, created_at) <= now() - interval '3 months') AS "quarterlyReviewDue"
`;

const SELECT_GOAL_REVIEWS = sql`
  COALESCE((
    SELECT jsonb_agg(review ORDER BY review."reviewedAt" DESC)
    FROM (
      SELECT gr.id, gr.cadence, gr.assessment, gr.evidence, gr.decisions,
        gr.next_actions AS "nextActions", gr.reviewed_at AS "reviewedAt",
        gr.created_at AS "createdAt"
      FROM goal_reviews gr
      WHERE gr.goal_id = personal_goals.id
      ORDER BY gr.reviewed_at DESC
      LIMIT 20
    ) review
  ), '[]'::jsonb) AS reviews,
  (SELECT count(*)::int FROM goal_reviews gr WHERE gr.goal_id = personal_goals.id) AS "reviewCount",
  (SELECT count(*)::int FROM goal_reviews gr WHERE gr.goal_id = personal_goals.id AND gr.cadence = 'weekly') AS "weeklyReviewCount",
  (SELECT count(*)::int FROM goal_reviews gr WHERE gr.goal_id = personal_goals.id AND gr.cadence = 'quarterly') AS "quarterlyReviewCount"
`;

const SELECT_OPPORTUNITY = sql`
  id, project_key AS "projectKey", goal_id AS "goalId", title, observation,
  why_now AS "whyNow", proposed_action AS "proposedAction",
  expected_value AS "expectedValue", risk, action_class AS "actionClass",
  approval_required AS "approvalRequired", evidence, content_hash AS "contentHash",
  status, checkpoint_id AS "checkpointId", parked_item_id AS "parkedItemId",
  resolution_reason AS "resolutionReason", created_at AS "createdAt",
  updated_at AS "updatedAt", resolved_at AS "resolvedAt"
`;

const SELECT_CANDIDATE = sql`
  id, project_key AS "projectKey", pattern_key AS "patternKey", summary,
  qualifying_checkpoint_ids AS "qualifyingCheckpointIds", successful_runs AS "successfulRuns",
  status, resolution_reason AS "resolutionReason",
  materialized_checkpoint_id AS "materializedCheckpointId",
  created_at AS "createdAt", updated_at AS "updatedAt", resolved_at AS "resolvedAt"
`;

export function createPersonalDirectionService(db: Database): PersonalDirectionService {
  async function createGoal(input: SaveGoalInput): Promise<Record<string, unknown>> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DirectionValidationError("goal body must be an object");
    const projectKey = canonicalizeCheckpointProjectKey(input.projectKey);
    const priority = input.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new DirectionValidationError("priority must be an integer from 1 to 5");
    const status = input.status ?? "active";
    if (!(["active", "paused", "completed", "abandoned"] as string[]).includes(status)) throw new DirectionValidationError("goal status is invalid");
    const rows = await db.execute(sql`
      INSERT INTO personal_goals (
        project_key, title, outcome, success_criteria, constraints, priority,
        status, target_date, observation_scopes, completed_at
      ) VALUES (
        ${projectKey}, ${requiredText(input.title, "title", 500)}, ${requiredText(input.outcome, "outcome", 20_000)},
        ${JSON.stringify(stringList(input.successCriteria, "successCriteria"))}::jsonb,
        ${JSON.stringify(stringList(input.constraints, "constraints"))}::jsonb,
        ${priority}, ${status}, ${dateOrNull(input.targetDate, "targetDate")}::timestamptz,
        ${JSON.stringify(normalizeObservationScopes(input.observationScopes))}::jsonb,
        ${status === "completed" ? new Date().toISOString() : null}::timestamptz
      ) RETURNING ${SELECT_GOAL}
    `) as unknown as Record<string, unknown>[];
    return rows[0];
  }

  async function updateGoal(idInput: string, input: UpdateGoalInput): Promise<Record<string, unknown>> {
    const id = uuid(idInput, "goal id");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DirectionValidationError("goal update must be an object");
    const sets: SQL[] = [];
    if (input.title !== undefined) sets.push(sql`title = ${requiredText(input.title, "title", 500)}`);
    if (input.outcome !== undefined) sets.push(sql`outcome = ${requiredText(input.outcome, "outcome", 20_000)}`);
    if (input.successCriteria !== undefined) sets.push(sql`success_criteria = ${JSON.stringify(stringList(input.successCriteria, "successCriteria"))}::jsonb`);
    if (input.constraints !== undefined) sets.push(sql`constraints = ${JSON.stringify(stringList(input.constraints, "constraints"))}::jsonb`);
    if (input.priority !== undefined) {
      if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5) throw new DirectionValidationError("priority must be an integer from 1 to 5");
      sets.push(sql`priority = ${input.priority}`);
    }
    if (input.status !== undefined) {
      if (!(["active", "paused", "completed", "abandoned"] as string[]).includes(input.status)) throw new DirectionValidationError("goal status is invalid");
      sets.push(sql`status = ${input.status}`);
      sets.push(sql`completed_at = ${input.status === "completed" ? new Date().toISOString() : null}::timestamptz`);
    }
    if (input.targetDate !== undefined) sets.push(sql`target_date = ${dateOrNull(input.targetDate, "targetDate")}::timestamptz`);
    if (input.observationScopes !== undefined) sets.push(sql`observation_scopes = ${JSON.stringify(normalizeObservationScopes(input.observationScopes))}::jsonb`);
    if (!sets.length) throw new DirectionValidationError("goal update contains no fields");
    sets.push(sql`updated_at = now()`);
    const rows = await db.execute(sql`
      UPDATE personal_goals SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id}::uuid RETURNING ${SELECT_GOAL}
    `) as unknown as Record<string, unknown>[];
    if (!rows[0]) throw new DirectionNotFoundError("goal not found");
    return rows[0];
  }

  async function listGoalPage(input: { project?: string; status?: PersonalGoalStatus; reviewDue?: GoalReviewCadence; goalId?: string; limit?: number } = {}): Promise<{ goals: Record<string, unknown>[]; total: number }> {
    const conditions: SQL[] = [];
    if (input.project) conditions.push(sql`project_key = ${canonicalizeCheckpointProjectKey(input.project)}`);
    if (input.goalId) conditions.push(sql`id = ${uuid(input.goalId, "goalId")}::uuid`);
    if (input.status) {
      if (!(["active", "paused", "completed", "abandoned"] as string[]).includes(input.status)) throw new DirectionValidationError("goal status is invalid");
      conditions.push(sql`status = ${input.status}`);
    }
    if (input.reviewDue && !(["weekly", "quarterly"] as string[]).includes(input.reviewDue)) {
      throw new DirectionValidationError("reviewDue is invalid");
    }
    if (input.reviewDue) conditions.push(sql`status = 'active'`);
    if (input.reviewDue === "weekly") conditions.push(sql`COALESCE(last_weekly_review_at, created_at) <= now() - interval '7 days'`);
    if (input.reviewDue === "quarterly") conditions.push(sql`COALESCE(last_quarterly_review_at, created_at) <= now() - interval '3 months'`);
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
    const rows = await db.execute(sql`
      SELECT ${SELECT_GOAL}, ${SELECT_GOAL_REVIEWS}, count(*) OVER()::int AS "matchingTotal"
      FROM personal_goals ${where}
      ORDER BY priority ASC, updated_at DESC LIMIT ${limit}
    `) as unknown as Record<string, unknown>[];
    return { total: Number(rows[0]?.matchingTotal ?? 0), goals: rows.map(({ matchingTotal: _total, ...goal }) => ({ ...goal, intentAuthority: "explicit-goal" })) };
  }

  async function listGoals(input: Parameters<PersonalDirectionService["listGoals"]>[0] = {}) {
    return (await listGoalPage(input)).goals;
  }

  async function recordGoalReview(idInput: string, input: GoalReviewInput): Promise<Record<string, unknown>> {
    const id = uuid(idInput, "goal id");
    if (!(["weekly", "quarterly"] as string[]).includes(input?.cadence)) throw new DirectionValidationError("cadence is invalid");
    if (!(["on-track", "at-risk", "blocked", "complete"] as string[]).includes(input?.assessment)) throw new DirectionValidationError("assessment is invalid");
    const reviewedAt = input.reviewedAt ? dateOrNull(input.reviewedAt, "reviewedAt")! : new Date().toISOString();
    return db.transaction(async (tx) => {
      const goals = await tx.execute(sql`SELECT id FROM personal_goals WHERE id = ${id}::uuid LIMIT 1 FOR UPDATE`) as unknown as Array<{ id: string }>;
      if (!goals[0]) throw new DirectionNotFoundError("goal not found");
      const reviews = await tx.execute(sql`
        INSERT INTO goal_reviews (goal_id, cadence, assessment, evidence, decisions, next_actions, reviewed_at)
        VALUES (
          ${id}::uuid, ${input.cadence}, ${input.assessment},
          ${JSON.stringify(normalizeDirectionEvidence(input.evidence))}::jsonb,
          ${JSON.stringify(stringList(input.decisions, "decisions", 100, 5_000))}::jsonb,
          ${JSON.stringify(stringList(input.nextActions, "nextActions", 100, 5_000))}::jsonb,
          ${reviewedAt}::timestamptz
        ) RETURNING id, goal_id AS "goalId", cadence, assessment, evidence, decisions,
          next_actions AS "nextActions", reviewed_at AS "reviewedAt", created_at AS "createdAt"
      `) as unknown as Record<string, unknown>[];
      const reviewColumn = input.cadence === "weekly" ? sql`last_weekly_review_at` : sql`last_quarterly_review_at`;
      await tx.execute(sql`
        UPDATE personal_goals
        SET ${reviewColumn} = GREATEST(COALESCE(${reviewColumn}, ${reviewedAt}::timestamptz), ${reviewedAt}::timestamptz),
          updated_at = now()
        WHERE id = ${id}::uuid
      `);
      return reviews[0];
    });
  }

  async function proposeOpportunity(input: ProposeOpportunityInput): Promise<{ opportunity: Record<string, unknown>; deduped: boolean }> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DirectionValidationError("opportunity body must be an object");
    const projectKey = canonicalizeCheckpointProjectKey(input.projectKey);
    const goalId = input.goalId ? uuid(input.goalId, "goalId") : null;
    const levels = ["low", "medium", "high"];
    if (!levels.includes(input.expectedValue)) throw new DirectionValidationError("expectedValue is invalid");
    if (!levels.includes(input.risk)) throw new DirectionValidationError("risk is invalid");
    const title = requiredText(input.title, "title", 500);
    const observation = requiredText(input.observation, "observation", 20_000);
    const whyNow = requiredText(input.whyNow, "whyNow", 20_000);
    const proposedAction = requiredText(input.proposedAction, "proposedAction", 20_000);
    const evidence = normalizeDirectionEvidence(input.evidence);
    const actionClass = optionalText(input.actionClass, "actionClass", 200);
    const contentHash = hashOpportunity({
      projectKey,
      goalId,
      title,
      observation,
      whyNow,
      proposedAction,
      expectedValue: input.expectedValue,
      risk: input.risk,
      actionClass,
      approvalRequired: input.approvalRequired !== false,
      evidence: evidence.map((item) => ({
        sourceKind: item.sourceKind,
        reference: item.reference,
        sha256: item.sha256,
      })),
    });

    if (goalId) {
      const goals = await db.execute(sql`SELECT project_key AS "projectKey" FROM personal_goals WHERE id = ${goalId}::uuid LIMIT 1`) as unknown as Array<{ projectKey: string }>;
      if (!goals[0]) throw new DirectionValidationError("goalId does not exist");
      if (goals[0].projectKey !== projectKey) throw new DirectionValidationError("goalId belongs to a different project");
    }

    const existing = await db.execute(sql`
      SELECT ${SELECT_OPPORTUNITY} FROM personal_opportunities
      WHERE project_key = ${projectKey} AND content_hash = ${contentHash}
        AND status IN ('open','accepted','in_progress','parked') LIMIT 1
    `) as unknown as Record<string, unknown>[];
    if (existing[0]) return { opportunity: existing[0], deduped: true };

    try {
      const rows = await db.execute(sql`
        INSERT INTO personal_opportunities (
          project_key, goal_id, title, observation, why_now, proposed_action,
          expected_value, risk, action_class, approval_required, evidence, content_hash
        ) VALUES (
          ${projectKey}, ${goalId}::uuid, ${title}, ${observation}, ${whyNow}, ${proposedAction},
          ${input.expectedValue}, ${input.risk}, ${actionClass}, ${input.approvalRequired !== false},
          ${JSON.stringify(evidence)}::jsonb, ${contentHash}
        ) RETURNING ${SELECT_OPPORTUNITY}
      `) as unknown as Record<string, unknown>[];
      return { opportunity: rows[0], deduped: false };
    } catch (error) {
      if (((error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code) !== "23505") throw error;
      const rows = await db.execute(sql`
        SELECT ${SELECT_OPPORTUNITY} FROM personal_opportunities
        WHERE project_key = ${projectKey} AND content_hash = ${contentHash}
          AND status IN ('open','accepted','in_progress','parked') LIMIT 1
      `) as unknown as Record<string, unknown>[];
      if (!rows[0]) throw error;
      return { opportunity: rows[0], deduped: true };
    }
  }

  async function listOpportunities(input: { project?: string; status?: OpportunityStatus; goalId?: string; limit?: number } = {}): Promise<Record<string, unknown>[]> {
    const conditions: SQL[] = [];
    if (input.project) conditions.push(sql`project_key = ${canonicalizeCheckpointProjectKey(input.project)}`);
    if (input.goalId) conditions.push(sql`goal_id = ${uuid(input.goalId, "goalId")}::uuid`);
    if (input.status) {
      if (!(["open", "accepted", "in_progress", "parked", "dismissed", "completed"] as string[]).includes(input.status)) throw new DirectionValidationError("opportunity status is invalid");
      conditions.push(sql`status = ${input.status}`);
    }
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
      SELECT ${SELECT_OPPORTUNITY} FROM personal_opportunities ${where}
      ORDER BY CASE expected_value WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        CASE risk WHEN 'low' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC
      LIMIT ${limit}
    `) as unknown as Record<string, unknown>[];
      return Promise.all(rows.map(async (row) => {
        if (!row.checkpointId) return row;
        const completion = await readEffectiveCompletion(tx, String(row.checkpointId));
        return { ...row, effectiveVerification: completion?.effectiveVerification ?? { state: "unavailable", receiptIds: [] },
          evidenceState: isEffectivelyPassed(completion) ? "valid" : "evidence-invalid" };
      }));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function resolveOpportunity(idInput: string, input: OpportunityResolution): Promise<Record<string, unknown>> {
    const id = uuid(idInput, "opportunity id");
    if (!input || !["accept", "dismiss", "park"].includes(input.action)) throw new DirectionValidationError("resolution action is invalid");
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT status FROM personal_opportunities WHERE id = ${id}::uuid LIMIT 1 FOR UPDATE`) as unknown as Array<{ status: OpportunityStatus }>;
      if (!rows[0]) throw new DirectionNotFoundError("opportunity not found");
      if (!ACTIVE_OPPORTUNITY_STATES.includes(rows[0].status) || rows[0].status === "in_progress") throw new DirectionConflictError(`opportunity cannot be resolved from ${rows[0].status}`);
      let status: OpportunityStatus;
      let parkedItemId: string | null = null;
      if (input.action === "accept") status = "accepted";
      else if (input.action === "dismiss") {
        requiredText(input.reason, "reason", 2_000);
        status = "dismissed";
      } else {
        parkedItemId = requiredText(input.parkedItemId, "parkedItemId", 500);
        const parked = await tx.execute(sql`SELECT id, status FROM parked_items WHERE id = ${parkedItemId} LIMIT 1`) as unknown as Array<{ id: string; status: string }>;
        if (!parked[0] || parked[0].status === "closed") throw new DirectionValidationError("parkedItemId must reference an active parked item");
        status = "parked";
      }
      const updated = await tx.execute(sql`
        UPDATE personal_opportunities SET status = ${status}, parked_item_id = ${parkedItemId},
          resolution_reason = ${optionalText(input.reason, "reason", 2_000)}, updated_at = now(),
          resolved_at = ${status === "dismissed" ? new Date().toISOString() : null}::timestamptz
        WHERE id = ${id}::uuid RETURNING ${SELECT_OPPORTUNITY}
      `) as unknown as Record<string, unknown>[];
      return updated[0];
    });
  }

  async function workflowEligibility(executor: Pick<Database, "execute">, row: Record<string, unknown>, lock = false) {
    const ids = Array.isArray(row.qualifyingCheckpointIds) ? [...new Set(row.qualifyingCheckpointIds as string[])].sort() : [];
    let eligibleSuccessfulRuns = 0;
    for (const checkpointId of ids) {
      const evidence = await readEffectiveCompletion(executor, checkpointId, lock);
      if (evidence?.projectKey === row.projectKey && isEffectivelyPassed(evidence)) eligibleSuccessfulRuns++;
    }
    let materializedValid = true;
    if (row.materializedCheckpointId) materializedValid = isEffectivelyPassed(await readEffectiveCompletion(executor, String(row.materializedCheckpointId), lock));
    return { eligibleSuccessfulRuns, evidenceState: eligibleSuccessfulRuns >= 3 && materializedValid ? "valid" : "evidence-invalid" };
  }

  async function listWorkflowCandidates(input: { project?: string; status?: WorkflowCandidateStatus; limit?: number } = {}): Promise<Record<string, unknown>[]> {
    const conditions: SQL[] = [];
    if (input.project) conditions.push(sql`project_key = ${canonicalizeCheckpointProjectKey(input.project)}`);
    if (input.status) {
      if (!(["candidate", "approved", "dismissed", "materialized"] as string[]).includes(input.status)) throw new DirectionValidationError("candidate status is invalid");
      conditions.push(sql`status = ${input.status}`);
    }
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT ${SELECT_CANDIDATE} FROM workflow_candidates ${where} ORDER BY updated_at DESC LIMIT ${limit}`) as unknown as Record<string, unknown>[];
      return Promise.all(rows.map(async (row) => ({ ...row, ...await workflowEligibility(tx, row) })));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function resolveWorkflowCandidate(idInput: string, input: WorkflowCandidateResolution): Promise<Record<string, unknown>> {
    const id = uuid(idInput, "workflow candidate id");
    if (!input || !["approve", "dismiss", "materialize"].includes(input.action)) throw new DirectionValidationError("candidate resolution action is invalid");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      const candidates = await tx.execute(sql`
        SELECT status, project_key AS "projectKey", pattern_key AS "patternKey", qualifying_checkpoint_ids AS "qualifyingCheckpointIds"
        FROM workflow_candidates WHERE id = ${id}::uuid LIMIT 1 FOR UPDATE
      `) as unknown as Array<{ status: WorkflowCandidateStatus; projectKey: string; patternKey: string; qualifyingCheckpointIds: string[] }>;
      if (!candidates[0]) throw new DirectionNotFoundError("workflow candidate not found");
      if (input.action !== "dismiss" && (await workflowEligibility(tx, candidates[0], true)).evidenceState !== "valid") throw new DirectionConflictError("candidate qualifying evidence is invalid or unavailable");
      let status: WorkflowCandidateStatus;
      let checkpointId: string | null = null;
      if (input.action === "approve") {
        if (candidates[0].status !== "candidate") throw new DirectionConflictError("only a candidate can be approved");
        status = "approved";
      } else if (input.action === "dismiss") {
        if (candidates[0].status === "materialized") throw new DirectionConflictError("materialized candidate cannot be dismissed");
        requiredText(input.reason, "reason", 2_000);
        status = "dismissed";
      } else {
        if (candidates[0].status !== "approved") throw new DirectionConflictError("candidate must be approved before materialization");
        checkpointId = uuid(input.checkpointId, "checkpointId");
        const completion = await readEffectiveCompletion(tx, checkpointId, true);
        const artifacts = await tx.execute(sql`
          SELECT ca.id FROM checkpoint_artifacts ca JOIN work_checkpoints wc ON wc.id = ca.checkpoint_id
          WHERE wc.id = ${checkpointId}::uuid AND wc.pattern_key = ${candidates[0].patternKey}
            AND ca.sha256 IN (SELECT subject_revision FROM verification_receipts
              WHERE checkpoint_id = ${checkpointId}::uuid AND id = ANY(${`{${completion?.effectiveVerification.receiptIds.join(',') ?? ''}}`}::uuid[]))
        `) as unknown[];
        if (!completion || completion.projectKey !== candidates[0].projectKey || !isEffectivelyPassed(completion) || !artifacts.length) {
          throw new DirectionConflictError("materialization requires a same-pattern completed checkpoint and artifact hash matching its effective passed verification");
        }
        status = "materialized";
      }
      const updated = await tx.execute(sql`
        UPDATE workflow_candidates SET status = ${status}, resolution_reason = ${optionalText(input.reason, "reason", 2_000)},
          materialized_checkpoint_id = ${checkpointId}::uuid, updated_at = now(), resolved_at = now()
        WHERE id = ${id}::uuid RETURNING ${SELECT_CANDIDATE}
      `) as unknown as Record<string, unknown>[];
      return updated[0];
    });
  }

  return {
    createGoal,
    updateGoal,
    listGoals,
    listGoalPage,
    recordGoalReview,
    proposeOpportunity,
    listOpportunities,
    resolveOpportunity,
    listWorkflowCandidates,
    resolveWorkflowCandidate,
  };
}

export { PATTERN_KEY_RE };
