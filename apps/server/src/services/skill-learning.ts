import { skillBundleHash as hashSkillBundle } from "@seneca/core";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type {
  Database,
  SkillCandidateEvidenceSnapshot,
  SkillCandidateStatus,
  SkillChangeType,
  SkillResultDisposition,
  SkillScope,
  SkillSignalSeverity,
  SkillSignalType,
  SkillVerificationState,
} from "@seneca/db";
import { sanitizeSecrets } from "@seneca/memory";
import { canonicalizeCheckpointProjectKey } from "./checkpoints.js";
import { readEffectiveCompletion, isEffectivelyPassed } from "./checkpoint-verification.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LEARNING_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FORBIDDEN_INPUT_KEYS = new Set(["prompt", "response", "reasoning", "transcript", "messages", "toolOutput", "tool_output"]);
const SIGNAL_TYPES: SkillSignalType[] = [
  "correction", "rejection", "workaround", "routing-miss", "missing-context",
  "stale-reference", "quality-gap", "verification-failure", "safety-failure", "agent-boundary",
];
const CHANGE_TYPES: SkillChangeType[] = ["update", "split", "merge", "retire", "new-skill", "agent-evaluation"];
const SEVERITIES: SkillSignalSeverity[] = ["ordinary", "material", "critical"];
const RESULTS: SkillResultDisposition[] = ["accepted", "revised", "discarded", "failed"];
const VERIFICATIONS: SkillVerificationState[] = ["passed", "failed", "not-required", "unverified"];
const CANDIDATE_STATES: SkillCandidateStatus[] = ["candidate", "approved", "dismissed", "materialized"];
const IMMEDIATE_TYPES = new Set<SkillSignalType>(["correction", "rejection", "verification-failure", "safety-failure"]);
const RUN_INPUT_KEYS = new Set([
  "projectKey", "provider", "nativeTaskId", "skillName", "resultDisposition",
  "verificationState", "checkpointId", "externalSkillDependencies", "completedAt", "signals",
]);
const SIGNAL_INPUT_KEYS = new Set(["type", "learningKey", "changeType", "severity", "summary"]);

type MatrixSkill = {
  name: string;
  scope: SkillScope;
  status: string;
  learningRole?: "tracked" | "controller" | "excluded";
};

type Matrix = {
  canonicalRoot: string;
  userCanonicalRoot: string;
  skills: MatrixSkill[];
};

export interface SkillRunSignalInput {
  type: SkillSignalType;
  learningKey: string;
  changeType: SkillChangeType;
  severity?: SkillSignalSeverity;
  summary: string;
}

export interface RecordSkillRunInput {
  projectKey: string;
  provider: string;
  nativeTaskId: string;
  skillName: string;
  resultDisposition: SkillResultDisposition;
  verificationState: SkillVerificationState;
  checkpointId?: string | null;
  externalSkillDependencies?: string[];
  completedAt?: string;
  signals?: SkillRunSignalInput[];
  [key: string]: unknown;
}

export type SkillCandidateResolution =
  | { action: "approve"; reason?: string }
  | { action: "dismiss"; reason: string }
  | { action: "materialize"; reason?: string; checkpointId: string };

export interface SkillLearningService {
  recordSkillRun(input: RecordSkillRunInput): Promise<Record<string, unknown>>;
  listSkillUsage(input?: { project?: string; skill?: string; version?: string; since?: string; limit?: number }): Promise<Record<string, unknown>[]>;
  listCandidates(input?: { project?: string; skill?: string; type?: SkillChangeType; severity?: SkillSignalSeverity; status?: SkillCandidateStatus; limit?: number }): Promise<Record<string, unknown>[]>;
  resolveCandidate(id: string, input: SkillCandidateResolution): Promise<Record<string, unknown>>;
  compact(input?: { retentionDays?: number; now?: string }): Promise<{ eligibleReceipts: number; deletedReceipts: number; retentionDays: number; cutoff: string; paused?: boolean; reason?: string }>;
}

export class SkillLearningValidationError extends Error {}
export class SkillLearningNotFoundError extends Error {}
export class SkillLearningConflictError extends Error {}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new SkillLearningValidationError(`${field} is required`);
  const text = value.trim();
  if (text.length > max) throw new SkillLearningValidationError(`${field} exceeds ${max} characters`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, max);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new SkillLearningValidationError(`${field} must be a UUID`);
  return value.toLowerCase();
}

function isoDate(value: unknown, field: string, fallback?: string): string {
  const candidate = value ?? fallback;
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    throw new SkillLearningValidationError(`${field} must be an ISO date`);
  }
  return new Date(candidate).toISOString();
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new SkillLearningValidationError(`${field} is invalid`);
  }
  return value as T;
}

function stringList(value: unknown, field: string, maxItems = 25): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new SkillLearningValidationError(`${field} must be an array of at most ${maxItems} items`);
  }
  return [...new Set(value.map((entry, index) => requiredText(entry, `${field}[${index}]`, 128)))].sort();
}

function compactSummary(value: unknown, field: string): string {
  const raw = requiredText(value, field, 500);
  const transcriptLines = raw.split(/\r?\n/).filter((line) => /^(?:user|assistant|system|tool)\s*:/i.test(line.trim()));
  if (transcriptLines.length >= 2 || /<realtime_delegation>|\"role\"\s*:\s*\"(?:user|assistant|system)\"/i.test(raw)) {
    throw new SkillLearningValidationError(`${field} must be a compact evidence summary, not transcript-shaped content`);
  }
  return sanitizeSecrets(raw);
}

function rejectRawConversationFields(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_INPUT_KEYS.has(key)) {
      throw new SkillLearningValidationError(`${key} is forbidden; skill learning stores no conversation content`);
    }
  }
}

function requireExactKeys(input: Record<string, unknown>, allowed: Set<string>, field: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new SkillLearningValidationError(`${field} contains unsupported field ${unknown[0]}`);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function skillBundleHash(root: string): string {
  try { return hashSkillBundle(root); }
  catch (error) { throw new SkillLearningValidationError(error instanceof Error ? error.message : "invalid skill bundle"); }
}

function loadMatrix(projectRoot: string): Matrix {
  const configured = resolve(projectRoot, "configs/skill-matrix.json");
  const path = existsSync(configured) ? configured : resolve(projectRoot, "configs/personal-skill-matrix.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Matrix;
  } catch (error) {
    throw new SkillLearningValidationError(`skill matrix is unavailable (${String(error)})`);
  }
}

function canonicalSkill(matrix: Matrix, projectRoot: string, name: string): { skill: MatrixSkill; hash: string } {
  if (!NAME_RE.test(name)) throw new SkillLearningValidationError("skillName is invalid");
  const skill = matrix.skills.find((entry) => entry.name === name);
  if (!skill || skill.status !== "promoted") throw new SkillLearningValidationError("skillName is not a promoted governed skill");
  if (skill.learningRole !== "tracked") throw new SkillLearningValidationError("skillName is not tracked for learning telemetry");
  const configuredRoot = skill.scope === "repo" ? matrix.canonicalRoot : matrix.userCanonicalRoot;
  return { skill, hash: skillBundleHash(resolve(projectRoot, configuredRoot, name)) };
}

function normalizeSignals(value: unknown): Array<SkillRunSignalInput & { contentHash: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw new SkillLearningValidationError("signals must be an array of at most 10 items");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new SkillLearningValidationError(`signals[${index}] must be an object`);
    }
    const signal = entry as Record<string, unknown>;
    rejectRawConversationFields(signal);
    requireExactKeys(signal, SIGNAL_INPUT_KEYS, `signals[${index}]`);
    const type = enumValue(signal.type, `signals[${index}].type`, SIGNAL_TYPES);
    const changeType = enumValue(signal.changeType, `signals[${index}].changeType`, CHANGE_TYPES);
    if ((type === "agent-boundary") !== (changeType === "agent-evaluation")) {
      throw new SkillLearningValidationError(`signals[${index}] agent-boundary and agent-evaluation must be used together`);
    }
    const learningKey = requiredText(signal.learningKey, `signals[${index}].learningKey`, 120).toLowerCase();
    if (!LEARNING_KEY_RE.test(learningKey)) throw new SkillLearningValidationError(`signals[${index}].learningKey is invalid`);
    const requestedSeverity = signal.severity === undefined
      ? "ordinary"
      : enumValue(signal.severity, `signals[${index}].severity`, SEVERITIES);
    const severity = IMMEDIATE_TYPES.has(type) && requestedSeverity === "ordinary" ? "material" : requestedSeverity;
    const summary = compactSummary(signal.summary, `signals[${index}].summary`);
    return {
      type,
      learningKey,
      changeType,
      severity,
      summary,
      contentHash: stableHash({ type, learningKey, changeType, severity, summary }),
    };
  });
}

const SELECT_RECEIPT = sql`
  id, project_key AS "projectKey", provider, native_task_id AS "nativeTaskId",
  checkpoint_id AS "checkpointId", skill_name AS "skillName", skill_scope AS "skillScope",
  skill_hash AS "skillHash", result_disposition AS "resultDisposition",
  verification_state AS "verificationState", external_skill_dependencies AS "externalSkillDependencies",
  completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
`;

const SELECT_CANDIDATE = sql`
  id, project_key AS "projectKey", target_skill AS "targetSkill",
  change_type AS "changeType", learning_key AS "learningKey", title,
  proposed_change AS "proposedChange", severity, status,
  occurrence_count AS "occurrenceCount", evidence_snapshots AS "evidenceSnapshots",
  resolution_reason AS "resolutionReason",
  materialized_checkpoint_id AS "materializedCheckpointId",
  created_at AS "createdAt", updated_at AS "updatedAt", resolved_at AS "resolvedAt",
  CASE status
    WHEN 'candidate' THEN 'approve-or-dismiss'
    WHEN 'approved' THEN 'materialize-or-dismiss'
    ELSE 'none'
  END AS "nextPermittedTransition"
`;

function severityRank(value: SkillSignalSeverity): number {
  return value === "critical" ? 3 : value === "material" ? 2 : 1;
}

function candidateVisibility(snapshot: SkillCandidateEvidenceSnapshot): "immediate" | "deferred" {
  return IMMEDIATE_TYPES.has(snapshot.signalType) || snapshot.severity === "critical" ? "immediate" : "deferred";
}

export function createSkillLearningService(
  db: Database,
  options: { projectRoot?: string } = {},
): SkillLearningService {
  const projectRoot = resolve(options.projectRoot ?? fileURLToPath(new URL("../../../../", import.meta.url)));

  async function upsertCandidate(
    tx: Pick<Database, "execute">,
    receipt: Record<string, unknown>,
    signal: SkillRunSignalInput & { contentHash: string },
  ): Promise<(Record<string, unknown> & { visibility: "immediate" | "deferred" }) | null> {
    const verifiedAgentOnly = signal.type === "agent-boundary"
      ? sql`AND r.verification_state = 'passed'`
      : sql``;
    const rows = await tx.execute(sql`
      SELECT s.id AS "signalId", s.receipt_id AS "receiptId", s.signal_type AS "signalType",
        s.severity, s.summary, s.content_hash AS "contentHash", s.created_at AS "observedAt",
        r.provider, r.native_task_id AS "nativeTaskId", r.skill_hash AS "skillHash", r.checkpoint_id AS "checkpointId"
      FROM skill_learning_signals s
      JOIN skill_run_receipts r ON r.id = s.receipt_id
      WHERE r.project_key = ${receipt.projectKey as string}
        AND r.skill_name = ${receipt.skillName as string}
        AND s.change_type = ${signal.changeType}
        AND s.learning_key = ${signal.learningKey}
        ${verifiedAgentOnly}
      ORDER BY s.created_at ASC, s.id ASC
    `) as unknown as SkillCandidateEvidenceSnapshot[];
    const distinctTasks = new Set(rows.map((row) => `${row.provider}:${row.nativeTaskId}`));
    const immediate = IMMEDIATE_TYPES.has(signal.type) || signal.severity === "critical";
    if (!immediate && distinctTasks.size < 3) return null;

    const evidence = rows.slice(-20).map((row) => ({
      ...row,
      observedAt: new Date(row.observedAt).toISOString(),
    }));
    const severity = evidence.reduce<SkillSignalSeverity>(
      (highest, row) => severityRank(row.severity) > severityRank(highest) ? row.severity : highest,
      "ordinary",
    );
    const latest = evidence[evidence.length - 1];
    const title = `Review ${receipt.skillName as string}: ${signal.learningKey}`;
    const inserted = await tx.execute(sql`
      INSERT INTO skill_learning_candidates (
        project_key, target_skill, change_type, learning_key, title,
        proposed_change, severity, occurrence_count, evidence_snapshots
      ) VALUES (
        ${receipt.projectKey as string}, ${receipt.skillName as string}, ${signal.changeType},
        ${signal.learningKey}, ${title}, ${latest.summary}, ${severity},
        ${distinctTasks.size}, ${JSON.stringify(evidence)}::jsonb
      )
      ON CONFLICT (project_key, target_skill, change_type, learning_key) DO NOTHING
      RETURNING ${SELECT_CANDIDATE}
    `) as unknown as Record<string, unknown>[];
    if (inserted[0]) return { ...inserted[0], visibility: candidateVisibility(latest) };
    await tx.execute(sql`
      UPDATE skill_learning_candidates SET
        proposed_change = ${latest.summary}, severity = ${severity},
        occurrence_count = ${distinctTasks.size}, evidence_snapshots = ${JSON.stringify(evidence)}::jsonb,
        updated_at = now()
      WHERE status = 'candidate' AND project_key = ${receipt.projectKey as string}
        AND target_skill = ${receipt.skillName as string}
        AND change_type = ${signal.changeType}
        AND learning_key = ${signal.learningKey}
    `);
    return null;
  }

  async function recordSkillRun(input: RecordSkillRunInput): Promise<Record<string, unknown>> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SkillLearningValidationError("skill run body must be an object");
    rejectRawConversationFields(input);
    requireExactKeys(input, RUN_INPUT_KEYS, "skill run body");
    const matrix = loadMatrix(projectRoot);
    const skillName = requiredText(input.skillName, "skillName", 64);
    const governed = canonicalSkill(matrix, projectRoot, skillName);
    const projectKey = canonicalizeCheckpointProjectKey(requiredText(input.projectKey, "projectKey", 500));
    const provider = requiredText(input.provider, "provider", 64).toLowerCase();
    if (!PROVIDER_RE.test(provider)) throw new SkillLearningValidationError("provider is invalid");
    const nativeTaskId = requiredText(input.nativeTaskId, "nativeTaskId", 500);
    const checkpointId = input.checkpointId ? uuid(input.checkpointId, "checkpointId") : null;
    const resultDisposition = enumValue(input.resultDisposition, "resultDisposition", RESULTS);
    const verificationState = enumValue(input.verificationState, "verificationState", VERIFICATIONS);
    const externalSkillDependencies = stringList(input.externalSkillDependencies, "externalSkillDependencies");
    const completedAt = isoDate(input.completedAt, "completedAt", new Date().toISOString());
    const signals = normalizeSignals(input.signals);
    if (verificationState === "failed" && !signals.some((signal) => signal.type === "verification-failure")) {
      throw new SkillLearningValidationError("failed verification requires a concrete verification-failure signal");
    }

    if (!signals.length) return { recorded: false, reason: "no-learning-signal", receipt: null, candidates: [] };

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      if (checkpointId) {
        const checkpoints = await tx.execute(sql`SELECT id FROM work_checkpoints WHERE id = ${checkpointId}::uuid AND project_key = ${projectKey} FOR UPDATE`) as unknown[];
        if (!checkpoints.length) throw new SkillLearningConflictError("checkpoint does not exist in the exact project");
        const bindings = await tx.execute(sql`
          SELECT checkpoint_id FROM checkpoint_project_provider_refs WHERE checkpoint_id = ${checkpointId}::uuid
            AND project_key = ${projectKey} AND provider = ${provider} AND native_task_id = ${nativeTaskId}
          UNION SELECT checkpoint_id FROM checkpoint_provider_refs WHERE checkpoint_id = ${checkpointId}::uuid
            AND provider = ${provider} AND native_task_id = ${nativeTaskId}
        `) as unknown[];
        if (!bindings.length) throw new SkillLearningConflictError("checkpoint is not bound to the exact provider/task/project");
      }
      const previous = await tx.execute(sql`SELECT ${SELECT_RECEIPT} FROM skill_run_receipts
        WHERE provider = ${provider} AND native_task_id = ${nativeTaskId} AND project_key = ${projectKey}
          AND skill_name = ${governed.skill.name} AND skill_hash = ${governed.hash}
          AND checkpoint_id IS NOT DISTINCT FROM ${checkpointId}::uuid FOR UPDATE`) as unknown as Record<string, unknown>[];
      if (checkpointId && previous[0]) {
        const old = previous[0];
        const oldSignals = await tx.execute(sql`SELECT content_hash AS "contentHash" FROM skill_learning_signals WHERE receipt_id = ${old.id as string}::uuid ORDER BY content_hash`) as unknown as Array<{ contentHash: string }>;
        const signalHashes = [...new Set(signals.map((signal) => signal.contentHash))].sort();
        if (old.resultDisposition !== resultDisposition || old.verificationState !== verificationState
          || JSON.stringify(old.externalSkillDependencies) !== JSON.stringify(externalSkillDependencies)
          || JSON.stringify(oldSignals.map((signal) => signal.contentHash).sort()) !== JSON.stringify(signalHashes)
          || (input.completedAt !== undefined && new Date(old.completedAt as string).toISOString() !== completedAt)) {
          throw new SkillLearningConflictError("outcome skill receipt replay changed immutable evidence");
        }
        return { receipt: old, candidates: [], replayed: true };
      }
      const conflict = checkpointId ? sql`ON CONFLICT DO NOTHING` : sql`
        ON CONFLICT (provider, native_task_id, project_key, skill_name, skill_hash) WHERE checkpoint_id IS NULL
        DO UPDATE SET result_disposition = EXCLUDED.result_disposition, verification_state = EXCLUDED.verification_state,
          external_skill_dependencies = EXCLUDED.external_skill_dependencies, completed_at = EXCLUDED.completed_at, updated_at = now()`;
      const receipts = await tx.execute(sql`
        INSERT INTO skill_run_receipts (project_key, provider, native_task_id, checkpoint_id, skill_name,
          skill_scope, skill_hash, result_disposition, verification_state, external_skill_dependencies, completed_at)
        VALUES (${projectKey}, ${provider}, ${nativeTaskId}, ${checkpointId}::uuid,
          ${governed.skill.name}, ${governed.skill.scope}, ${governed.hash}, ${resultDisposition}, ${verificationState},
          ${JSON.stringify(externalSkillDependencies)}::jsonb, ${completedAt}::timestamptz)
        ${conflict} RETURNING ${SELECT_RECEIPT}
      `) as unknown as Record<string, unknown>[];
      const receipt = receipts[0];
      if (!receipt) throw new SkillLearningConflictError("skill receipt was concurrently created; replay the same evidence");
      const candidates: Array<Record<string, unknown>> = [];
      for (const signal of signals) {
        await tx.execute(sql`
          INSERT INTO skill_learning_signals (
            receipt_id, signal_type, learning_key, change_type,
            severity, summary, content_hash
          ) VALUES (
            ${receipt.id as string}::uuid, ${signal.type}, ${signal.learningKey},
            ${signal.changeType}, ${signal.severity}, ${signal.summary}, ${signal.contentHash}
          ) ON CONFLICT (receipt_id, signal_type, learning_key, content_hash) DO NOTHING
        `);
        const candidate = await upsertCandidate(tx as unknown as Pick<Database, "execute">, receipt, signal);
        if (candidate && !candidates.some((entry) => entry.id === candidate.id)) candidates.push(candidate);
      }
      return { receipt, candidates };
    });
  }

  async function listSkillUsage(
    input: { project?: string; skill?: string; version?: string; since?: string; limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const live: SQL[] = [];
    const rollup: SQL[] = [];
    if (input.project) {
      const project = canonicalizeCheckpointProjectKey(input.project);
      live.push(sql`r.project_key = ${project}`);
      rollup.push(sql`u.project_key = ${project}`);
    }
    if (input.skill) {
      const skill = requiredText(input.skill, "skill", 64);
      if (!NAME_RE.test(skill)) throw new SkillLearningValidationError("skill is invalid");
      live.push(sql`r.skill_name = ${skill}`);
      rollup.push(sql`u.skill_name = ${skill}`);
    }
    if (input.version) {
      const version = requiredText(input.version, "version", 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(version)) throw new SkillLearningValidationError("version must be a SHA-256 hash");
      live.push(sql`r.skill_hash = ${version}`);
      rollup.push(sql`u.skill_hash = ${version}`);
    }
    if (input.since) {
      const since = isoDate(input.since, "since");
      live.push(sql`r.completed_at >= ${since}::timestamptz`);
      rollup.push(sql`u.period_start >= date_trunc('month', ${since}::timestamptz)`);
    }
    const liveWhere = live.length ? sql`WHERE ${sql.join(live, sql` AND `)}` : sql``;
    const rollupWhere = rollup.length ? sql`WHERE ${sql.join(rollup, sql` AND `)}` : sql``;
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
    return db.execute(sql`
      WITH reported AS (
        SELECT r.*, COALESCE(sc.corrections, 0) AS corrections, COALESCE(sc.workarounds, 0) AS workarounds
        FROM skill_run_receipts r
        LEFT JOIN (SELECT receipt_id,
          count(*) FILTER (WHERE signal_type IN ('correction','rejection'))::int AS corrections,
          count(*) FILTER (WHERE signal_type = 'workaround')::int AS workarounds
          FROM skill_learning_signals GROUP BY receipt_id) sc ON sc.receipt_id = r.id
        ${liveWhere}
      ), tasks AS (
        SELECT provider, native_task_id, project_key, skill_name, skill_hash,
          CASE WHEN bool_or(result_disposition = 'failed') THEN 'failed'
            WHEN bool_or(result_disposition = 'discarded') THEN 'discarded'
            WHEN bool_or(result_disposition = 'revised') THEN 'revised' ELSE 'accepted' END AS disposition,
          sum(corrections)::int AS corrections, sum(workarounds)::int AS workarounds, max(completed_at) AS last_used_at
        FROM reported GROUP BY provider, native_task_id, project_key, skill_name, skill_hash
      ), live AS (
        SELECT project_key, skill_name, skill_hash, count(*)::int AS task_uses,
          count(*) FILTER (WHERE disposition = 'accepted')::int AS accepted_count,
          count(*) FILTER (WHERE disposition = 'revised')::int AS revised_count,
          count(*) FILTER (WHERE disposition = 'discarded')::int AS discarded_count,
          count(*) FILTER (WHERE disposition = 'failed')::int AS failed_count,
          sum(corrections)::int AS correction_count, sum(workarounds)::int AS workaround_count, max(last_used_at) AS last_used_at
        FROM tasks GROUP BY project_key, skill_name, skill_hash
      ), historical AS (
        SELECT u.project_key, u.skill_name, u.skill_hash, sum(u.task_uses)::int AS task_uses,
          max(u.last_used_at) AS last_used_at FROM skill_usage_rollups u ${rollupWhere}
        GROUP BY u.project_key, u.skill_name, u.skill_hash
      )
      SELECT COALESCE(l.project_key, h.project_key) AS "projectKey", COALESCE(l.skill_name, h.skill_name) AS "skillName",
        COALESCE(l.skill_hash, h.skill_hash) AS "skillHash", COALESCE(l.task_uses, 0) AS "taskUses",
        COALESCE(l.accepted_count, 0) AS "acceptedCount", COALESCE(l.revised_count, 0) AS "revisedCount",
        COALESCE(l.discarded_count, 0) AS "discardedCount", COALESCE(l.failed_count, 0) AS "failedCount",
        COALESCE(l.correction_count, 0) AS "correctionCount", COALESCE(l.workaround_count, 0) AS "workaroundCount",
        l.last_used_at AS "lastUsedAt", COALESCE(h.task_uses, 0) AS "legacyRollupTaskUses", h.last_used_at AS "legacyLastUsedAt",
        'live reported tasks; legacy rollups may overlap and are not added' AS coverage,
        'failed > discarded > revised > accepted' AS "dispositionAggregation",
        CASE WHEN l.last_used_at IS NULL THEN 'unavailable' WHEN l.last_used_at >= now() - interval '30 days' THEN 'fresh' ELSE 'stale' END AS "telemetryFreshness"
      FROM live l FULL OUTER JOIN historical h USING(project_key, skill_name, skill_hash)
      ORDER BY GREATEST(l.last_used_at, h.last_used_at) DESC LIMIT ${limit}
    `) as unknown as Record<string, unknown>[];
  }

  async function listCandidates(
    input: { project?: string; skill?: string; type?: SkillChangeType; severity?: SkillSignalSeverity; status?: SkillCandidateStatus; limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const conditions: SQL[] = [];
    if (input.project) conditions.push(sql`project_key = ${canonicalizeCheckpointProjectKey(input.project)}`);
    if (input.skill) {
      const skill = requiredText(input.skill, "skill", 64);
      if (!NAME_RE.test(skill)) throw new SkillLearningValidationError("skill is invalid");
      conditions.push(sql`target_skill = ${skill}`);
    }
    if (input.type) conditions.push(sql`change_type = ${enumValue(input.type, "type", CHANGE_TYPES)}`);
    if (input.severity) conditions.push(sql`severity = ${enumValue(input.severity, "severity", SEVERITIES)}`);
    if (input.status) conditions.push(sql`status = ${enumValue(input.status, "status", CANDIDATE_STATES)}`);
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
      SELECT ${SELECT_CANDIDATE}
      FROM skill_learning_candidates ${where}
      ORDER BY
        CASE severity WHEN 'critical' THEN 3 WHEN 'material' THEN 2 ELSE 1 END DESC,
        updated_at DESC
      LIMIT ${limit}
    `) as unknown as Record<string, unknown>[];
      return Promise.all(rows.map(async (row) => row.materializedCheckpointId
        ? { ...row, evidenceState: isEffectivelyPassed(await readEffectiveCompletion(tx, String(row.materializedCheckpointId))) ? "valid" : "evidence-invalid" }
        : row));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function resolveCandidate(idInput: string, input: SkillCandidateResolution): Promise<Record<string, unknown>> {
    const id = uuid(idInput, "candidate id");
    if (!input || !["approve", "dismiss", "materialize"].includes(input.action)) {
      throw new SkillLearningValidationError("candidate resolution action is invalid");
    }
    const resolution = input as unknown as Record<string, unknown>;
    const allowed = input.action === "materialize"
      ? new Set(["action", "reason", "checkpointId"])
      : new Set(["action", "reason"]);
    requireExactKeys(resolution, allowed, "candidate resolution");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      const candidates = await tx.execute(sql`
        SELECT status, project_key AS "projectKey", target_skill AS "targetSkill", change_type AS "changeType"
        FROM skill_learning_candidates WHERE id = ${id}::uuid LIMIT 1 FOR UPDATE
      `) as unknown as Array<{ status: SkillCandidateStatus; projectKey: string; targetSkill: string; changeType: SkillChangeType }>;
      const candidate = candidates[0];
      if (!candidate) throw new SkillLearningNotFoundError("skill learning candidate not found");
      let status: SkillCandidateStatus;
      let checkpointId: string | null = null;
      if (input.action === "approve") {
        if (candidate.status !== "candidate") throw new SkillLearningConflictError("only a candidate can be approved");
        status = "approved";
      } else if (input.action === "dismiss") {
        if (candidate.status === "materialized") throw new SkillLearningConflictError("materialized candidate cannot be dismissed");
        requiredText(input.reason, "reason", 2_000);
        status = "dismissed";
      } else {
        if (candidate.status !== "approved") throw new SkillLearningConflictError("candidate must be approved before materialization");
        checkpointId = uuid(input.checkpointId, "checkpointId");
        const artifactPredicate = candidate.changeType === "agent-evaluation"
          ? sql`
              ca.artifact_type = 'agent'
              AND ca.sha256 IS NOT NULL
              AND ca.metadata->>'temporaryPrototype' = 'true'
              AND ca.metadata->>'permanent' = 'false'
              AND ca.metadata->>'mandatoryAssertionsPassed' = 'true'
              AND ca.metadata->>'qualityRegression' = 'false'
              AND ca.metadata->>'safetyRegression' = 'false'
              AND (
                ca.metadata->>'baselineFailureFixed' = 'true'
                OR (
                  ca.metadata->>'improvementPercent' ~ '^[0-9]+(?:\\.[0-9]+)?$'
                  AND (ca.metadata->>'improvementPercent')::numeric >= 20
                )
              )
            `
          : sql`
              ca.artifact_type = 'skill'
              AND ca.sha256 IS NOT NULL
              AND ca.metadata->>'skillName' = ${candidate.targetSkill}
              AND ca.metadata->>'isolatedCanaryPassed' = 'true'
              AND ca.metadata->>'discoveryVerified' = 'true'
              AND length(COALESCE(ca.metadata->>'rollbackRef', '')) > 0
            `;
        const completion = await readEffectiveCompletion(tx, checkpointId, true);
        const artifacts = await tx.execute(sql`SELECT ca.id FROM checkpoint_artifacts ca
          WHERE ca.checkpoint_id = ${checkpointId}::uuid AND ${artifactPredicate}
            AND ca.sha256 IN (SELECT subject_revision FROM verification_receipts
              WHERE checkpoint_id = ${checkpointId}::uuid AND id = ANY(${`{${completion?.effectiveVerification.receiptIds.join(',') ?? ''}}`}::uuid[]))
        `) as unknown[];
        if (!completion || completion.projectKey !== candidate.projectKey || !isEffectivelyPassed(completion) || !artifacts.length) {
          throw new SkillLearningConflictError("materialization requires a same-project completed checkpoint and gated artifact hash matching its effective passed verification");
        }
        status = "materialized";
      }
      const reason = optionalText(input.reason, "reason", 2_000);
      const updated = await tx.execute(sql`
        UPDATE skill_learning_candidates SET
          status = ${status}, resolution_reason = ${reason},
          materialized_checkpoint_id = ${checkpointId}::uuid,
          updated_at = now(), resolved_at = now()
        WHERE id = ${id}::uuid
        RETURNING ${SELECT_CANDIDATE}
      `) as unknown as Record<string, unknown>[];
      return updated[0];
    });
  }

  async function compact(input: { retentionDays?: number; now?: string } = {}): Promise<{ eligibleReceipts: number; deletedReceipts: number; retentionDays: number; cutoff: string; paused?: boolean; reason?: string }> {
    const retentionDays = Math.max(30, Math.min(365, Number(input.retentionDays) || 90));
    const now = isoDate(input.now, "now", new Date().toISOString());
    const cutoff = new Date(Date.parse(now) - retentionDays * 86_400_000).toISOString();
    const counts = await db.execute(sql`SELECT count(*)::int AS count FROM skill_run_receipts WHERE completed_at < ${cutoff}::timestamptz`) as unknown as Array<{ count: number }>;
    // Legacy monthly aggregates cannot deduplicate a reused native task. Keep
    // source identities instead of deleting evidence or fabricating combined totals.
    return { eligibleReceipts: counts[0]?.count ?? 0, deletedReceipts: 0, retentionDays, cutoff,
      paused: true, reason: "preserve-exact-task-and-outcome-evidence" };
  }

  return { recordSkillRun, listSkillUsage, listCandidates, resolveCandidate, compact };
}
