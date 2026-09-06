// ============================================================
// BODHI 1.0 — provider-neutral checkpoint service
//
// Native task IDs are foreign references. The checkpoint UUID and canonical
// project key are the durable identity, so a future harness can attach without
// cloning the work history into another conversation store.
// ============================================================

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { canonicalProjectKey, ProjectRoutingV2Schema } from "@seneca/core";
import { sql, type SQL } from "drizzle-orm";
import { deriveEffectiveVerification, receiptRoot, readEffectiveCompletion, isEffectivelyPassed, type EffectiveVerification } from "./checkpoint-verification.js";
import type {
  CheckpointDecision,
  CheckpointNextAction,
  CheckpointOutcomeMetrics,
  CheckpointState,
  CompletionVerificationState,
  Database,
  RemainingWorkDisposition,
  VerificationReceiptStatus,
} from "@seneca/db";

export const CHECKPOINT_SCHEMA_VERSION = 3;

const projectRoutingPath = new URL("../../../../configs/project-routing.json", import.meta.url);
const projectRoutes = ProjectRoutingV2Schema.parse(JSON.parse(readFileSync(
  existsSync(projectRoutingPath) ? projectRoutingPath : new URL("../../../../configs/personal-project-routing.json", import.meta.url), "utf8",
))).projects;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STRICT_CYCLE_VERIFICATION_TEXT_LIMIT = 800;

export class CheckpointValidationError extends Error {}
export class CheckpointNotFoundError extends Error {}
export class CheckpointConflictError extends Error {}
export class CheckpointAmbiguityError extends CheckpointConflictError {
  readonly code = "ambiguous_checkpoint";
  constructor(readonly candidates: Array<{ id: string; projectKey: string; state?: string }>) {
    super("provider task has multiple checkpoint outcomes; supply an exact checkpoint UUID");
  }
}

export interface CheckpointProviderRefInput {
  provider: string;
  nativeTaskId: string;
  hostId?: string | null;
  workingDirectory?: string | null;
  taskUrl?: string | null;
  isPrimary?: boolean;
}

export interface SaveCheckpointInput {
  mode?: "create" | "update" | "select";
  checkpointId?: string;
  expectedContentHash?: string;
  expectedCurrentCheckpointId?: string | null;
  projectKey: string;
  objective?: string;
  summary?: string;
  state?: Exclude<CheckpointState, "completed">;
  decisions?: CheckpointDecision[];
  nextActions?: CheckpointNextAction[];
  entityIds?: string[];
  parentCheckpointId?: string | null;
  goalId?: string | null;
  opportunityId?: string | null;
  patternKey?: string | null;
  providerRef: CheckpointProviderRefInput;
}

export interface AttachArtifactInput {
  artifactType: string;
  uri: string;
  label?: string | null;
  sha256?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordVerificationInput {
  receiptId?: string;
  claimReceiptId?: string;
  subjectRevision?: string;
  supersedesReceiptId?: string;
  claim: string;
  expectedSignal: string;
  observedSignal?: string | null;
  evidenceSource: string;
  status?: VerificationReceiptStatus;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CompleteCheckpointInput {
  completionReceiptIds?: string[];
  summary: string;
  remainingWorkDisposition: RemainingWorkDisposition;
  verificationState: CompletionVerificationState;
  outcomeMetrics?: CheckpointOutcomeMetrics | null;
}

export interface FindCheckpointsInput {
  project?: string;
  state?: CheckpointState;
  objective?: string;
  entity?: string;
  provider?: string;
  providerTaskId?: string;
  since?: string;
  limit?: number;
}

export interface CheckpointRow {
  id: string;
  schemaVersion: number;
  projectKey: string;
  objective: string;
  summary: string;
  state: CheckpointState;
  decisions: CheckpointDecision[];
  nextActions: CheckpointNextAction[];
  entityIds: string[];
  parentCheckpointId: string | null;
  goalId: string | null;
  opportunityId: string | null;
  patternKey: string | null;
  outcomeMetrics: CheckpointOutcomeMetrics | null;
  remainingWorkDisposition: RemainingWorkDisposition | null;
  completionVerificationState: CompletionVerificationState | null;
  completionReceiptIds: string[] | null;
  contentHash: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
}

export interface CheckpointRecord extends CheckpointRow {
  effectiveVerification: EffectiveVerification;
  providerRefs: Array<{
    id: string;
    provider: string;
    nativeTaskId: string;
    hostId: string | null;
    workingDirectory: string | null;
    taskUrl: string | null;
    isPrimary: boolean;
    isCurrent: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  artifacts: Array<{
    id: string;
    artifactType: string;
    uri: string;
    label: string | null;
    sha256: string | null;
    metadata: Record<string, unknown>;
    createdAt: string | Date;
  }>;
  verificationReceipts: Array<{
    id: string;
    subjectRevision: string | null;
    supersedesReceiptId: string | null;
    claimReceiptId?: string | null;
    claim: string;
    expectedSignal: string;
    observedSignal: string | null;
    evidenceSource: string;
    status: VerificationReceiptStatus;
    observedAt: string | Date;
    metadata: Record<string, unknown>;
    createdAt: string | Date;
  }>;
}

export interface CheckpointMaintenanceReport {
  ok: true;
  staleActiveCount: number;
  pendingVerificationCount: number;
  changed: number;
  readOnly: true;
  thresholds: { activeDays: number; pendingVerificationDays: number };
}

export interface CheckpointService {
  save(input: SaveCheckpointInput): Promise<CheckpointRecord>;
  get(id: string): Promise<CheckpointRecord | null>;
  getByProvider(provider: string, nativeTaskId: string, projectKey?: string, selection?: "current"): Promise<CheckpointRecord | null>;
  find(input?: FindCheckpointsInput): Promise<Array<CheckpointRow & { effectiveVerification: EffectiveVerification }>>;
  attachArtifact(checkpointId: string, input: AttachArtifactInput): Promise<CheckpointRecord["artifacts"][number]>;
  recordVerification(checkpointId: string, input: RecordVerificationInput): Promise<CheckpointRecord["verificationReceipts"][number]>;
  complete(checkpointId: string, input: CompleteCheckpointInput): Promise<CheckpointRecord>;
  reconcileMaintenance(): Promise<CheckpointMaintenanceReport>;
}

/** Shared alias policy; explicit unknown project namespaces remain intact. */
export function canonicalizeCheckpointProjectKey(raw: string): string {
  try { return canonicalProjectKey(raw, projectRoutes); }
  catch (error) { throw new CheckpointValidationError(error instanceof Error ? error.message : "invalid projectKey"); }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}

export function hashCheckpointContent(content: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(stableValue(content))).digest("hex");
}

/** Completion with no remaining work must not retain stale pending actions. */
export function completionNextActions(
  nextActions: CheckpointNextAction[],
  disposition: RemainingWorkDisposition,
): CheckpointNextAction[] {
  return disposition === "none" ? [] : nextActions;
}

function requiredText(value: unknown, field: string, max = 20_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CheckpointValidationError(`${field} is required`);
  }
  if (value.trim().length > max) throw new CheckpointValidationError(`${field} exceeds ${max} characters`);
  return value.trim();
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new CheckpointValidationError(`${field} must be a string`);
  if (value.trim().length > max) throw new CheckpointValidationError(`${field} exceeds ${max} characters`);
  return value.trim();
}

function metadataObject(value: unknown): Record<string, unknown> {
  const metadata = value ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new CheckpointValidationError("metadata must be an object");
  }
  const encoded = JSON.stringify(metadata);
  if (encoded.length > 100_000) throw new CheckpointValidationError("metadata exceeds 100000 encoded characters");
  return metadata as Record<string, unknown>;
}

function uuid(value: string, field: string): string {
  if (!UUID_RE.test(value)) throw new CheckpointValidationError(`${field} must be a UUID`);
  return value.toLowerCase();
}

function normalizeProviderRef(input: CheckpointProviderRefInput): Required<Omit<CheckpointProviderRefInput, "hostId" | "workingDirectory" | "taskUrl">> & Pick<CheckpointProviderRefInput, "hostId" | "workingDirectory" | "taskUrl"> {
  const provider = requiredText(input?.provider, "provider", 64).toLowerCase();
  if (!PROVIDER_RE.test(provider)) throw new CheckpointValidationError("provider contains invalid characters");
  return {
    provider,
    nativeTaskId: requiredText(input?.nativeTaskId, "nativeTaskId", 500),
    hostId: optionalText(input?.hostId, "hostId", 500),
    workingDirectory: optionalText(input?.workingDirectory, "workingDirectory", 2_000),
    taskUrl: optionalText(input?.taskUrl, "taskUrl", 2_000),
    isPrimary: input?.isPrimary !== false,
  };
}

function normalizeDecisions(value: CheckpointDecision[] | undefined): CheckpointDecision[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) throw new CheckpointValidationError("decisions must be an array of at most 500 items");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CheckpointValidationError(`decisions[${index}] must be an object`);
    }
    return {
      text: requiredText(item.text, `decisions[${index}].text`, 10_000),
      ...(item.madeAt ? { madeAt: requiredText(item.madeAt, `decisions[${index}].madeAt`, 100) } : {}),
      ...(item.rationale ? { rationale: requiredText(item.rationale, `decisions[${index}].rationale`, 10_000) } : {}),
    };
  });
}

function normalizeNextActions(value: CheckpointNextAction[] | undefined): CheckpointNextAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) throw new CheckpointValidationError("nextActions must be an array of at most 500 items");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CheckpointValidationError(`nextActions[${index}] must be an object`);
    }
    if (item.status && !["pending", "done", "dropped"].includes(item.status)) {
      throw new CheckpointValidationError(`nextActions[${index}].status is invalid`);
    }
    return {
      text: requiredText(item?.text, `nextActions[${index}].text`, 10_000),
      ...(item.status ? { status: item.status } : {}),
      ...(item.owner ? { owner: requiredText(item.owner, `nextActions[${index}].owner`, 500) } : {}),
    };
  });
}

function normalizeEntityIds(value: string[] | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) throw new CheckpointValidationError("entityIds must be an array of at most 500 UUIDs");
  return [...new Set(value.map((id, index) => uuid(id, `entityIds[${index}]`)))].sort();
}

function normalizePatternKey(value: unknown): string | null {
  const patternKey = optionalText(value, "patternKey", 120)?.toLowerCase() ?? null;
  if (patternKey && !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(patternKey)) {
    throw new CheckpointValidationError(
      "patternKey must be a lowercase stable key using letters, numbers, dot, underscore, or hyphen",
    );
  }
  return patternKey;
}

function normalizeOutcomeMetrics(value: unknown): CheckpointOutcomeMetrics | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CheckpointValidationError("outcomeMetrics must be an object");
  }
  const input = value as Record<string, unknown>;
  if (!["accepted", "revised", "discarded"].includes(String(input.resultDisposition))) {
    throw new CheckpointValidationError("outcomeMetrics.resultDisposition is invalid");
  }
  const normalized: CheckpointOutcomeMetrics = {
    resultDisposition: input.resultDisposition as CheckpointOutcomeMetrics["resultDisposition"],
  };
  for (const field of ["reviewMinutes", "reworkCount", "completedWorkerOutcomes"] as const) {
    if (input[field] === undefined) continue;
    if (!Number.isInteger(input[field]) || Number(input[field]) < 0) {
      throw new CheckpointValidationError(`outcomeMetrics.${field} must be a non-negative integer`);
    }
    normalized[field] = Number(input[field]);
  }
  if (input.computeCostUsd !== undefined) {
    if (
      typeof input.computeCostUsd !== "number"
      || !Number.isFinite(input.computeCostUsd)
      || input.computeCostUsd < 0
    ) {
      throw new CheckpointValidationError("outcomeMetrics.computeCostUsd must be a non-negative number");
    }
    normalized.computeCostUsd = input.computeCostUsd;
  }
  return normalized;
}

function checkpointHashFields(row: Omit<CheckpointRow, "id" | "contentHash" | "createdAt" | "updatedAt" | "completedAt"> & { completedAt?: string | Date | null }): Record<string, unknown> {
  return {
    schemaVersion: row.schemaVersion,
    projectKey: row.projectKey,
    objective: row.objective,
    summary: row.summary,
    state: row.state,
    decisions: row.decisions,
    nextActions: row.nextActions,
    entityIds: row.entityIds,
    parentCheckpointId: row.parentCheckpointId,
    goalId: row.goalId,
    opportunityId: row.opportunityId,
    patternKey: row.patternKey,
    outcomeMetrics: row.outcomeMetrics,
    remainingWorkDisposition: row.remainingWorkDisposition,
    completionVerificationState: row.completionVerificationState,
    ...(row.schemaVersion >= 3 ? { completionReceiptIds: row.completionReceiptIds ?? null } : {}),
  };
}

const SELECT_CHECKPOINT = sql`
  id, schema_version AS "schemaVersion", project_key AS "projectKey",
  objective, summary, state, decisions, next_actions AS "nextActions",
  entity_ids AS "entityIds", parent_checkpoint_id AS "parentCheckpointId",
  goal_id AS "goalId", opportunity_id AS "opportunityId",
  pattern_key AS "patternKey", outcome_metrics AS "outcomeMetrics",
  remaining_work_disposition AS "remainingWorkDisposition",
  completion_verification_state AS "completionVerificationState",
  completion_receipt_ids AS "completionReceiptIds",
  content_hash AS "contentHash", created_at AS "createdAt",
  updated_at AS "updatedAt", completed_at AS "completedAt"
`;

export function createCheckpointService(db: Database): CheckpointService {
  async function getWith(executor: Pick<Database, "execute">, id: string): Promise<CheckpointRecord | null> {
    const checkpointRows = (await executor.execute(sql`
      SELECT ${SELECT_CHECKPOINT} FROM work_checkpoints WHERE id::text = ${id} LIMIT 1
    `)) as unknown as CheckpointRow[];
    const checkpoint = checkpointRows[0];
    if (!checkpoint) return null;

    const [providerRefs, artifacts, verificationReceipts] = await Promise.all([
      executor.execute(sql`
        SELECT id, provider, native_task_id AS "nativeTaskId", host_id AS "hostId",
          working_directory AS "workingDirectory", task_url AS "taskUrl",
          is_primary AS "isPrimary", is_current AS "isCurrent", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM checkpoint_project_provider_refs WHERE checkpoint_id = ${checkpoint.id}::uuid
        UNION ALL
        SELECT id, provider, native_task_id AS "nativeTaskId", host_id AS "hostId",
          working_directory AS "workingDirectory", task_url AS "taskUrl",
          is_primary AS "isPrimary", false AS "isCurrent", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM checkpoint_provider_refs WHERE checkpoint_id = ${checkpoint.id}::uuid
        ORDER BY "isPrimary" DESC, "createdAt" ASC
      `),
      executor.execute(sql`
        SELECT id, artifact_type AS "artifactType", uri, label, sha256, metadata,
          created_at AS "createdAt"
        FROM checkpoint_artifacts WHERE checkpoint_id = ${checkpoint.id}::uuid
        ORDER BY created_at ASC
      `),
      executor.execute(sql`
        SELECT id, claim, expected_signal AS "expectedSignal", observed_signal AS "observedSignal",
          evidence_source AS "evidenceSource", status, observed_at AS "observedAt",
          metadata, created_at AS "createdAt", subject_revision AS "subjectRevision", supersedes_receipt_id AS "supersedesReceiptId"
        FROM verification_receipts WHERE checkpoint_id = ${checkpoint.id}::uuid
        ORDER BY created_at ASC
      `),
    ]);

    return {
      ...checkpoint,
      decisions: checkpoint.decisions ?? [],
      nextActions: checkpoint.nextActions ?? [],
      entityIds: checkpoint.entityIds ?? [],
      providerRefs: providerRefs as unknown as CheckpointRecord["providerRefs"],
      artifacts: artifacts as unknown as CheckpointRecord["artifacts"],
      completionReceiptIds: checkpoint.completionReceiptIds ?? null,
      verificationReceipts: (verificationReceipts as unknown as CheckpointRecord["verificationReceipts"]).map((receipt) => ({
        ...receipt, claimReceiptId: receiptRoot(receipt.id, verificationReceipts as unknown as CheckpointRecord["verificationReceipts"]),
      })),
      effectiveVerification: deriveEffectiveVerification({ ...checkpoint, completionReceiptIds: checkpoint.completionReceiptIds ?? null }, verificationReceipts as unknown as CheckpointRecord["verificationReceipts"]),
    };
  }

  async function get(id: string): Promise<CheckpointRecord | null> {
    id = uuid(id, "checkpoint id");
    return db.transaction((tx) => getWith(tx, id), { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function getByProvider(providerInput: string, nativeTaskIdInput: string, projectKeyInput?: string, selection?: "current"): Promise<CheckpointRecord | null> {
    const { provider, nativeTaskId } = normalizeProviderRef({ provider: providerInput, nativeTaskId: nativeTaskIdInput });
    if (selection !== undefined && selection !== "current") throw new CheckpointValidationError("selection must be current when provided");
    const projectKey = projectKeyInput ? canonicalizeCheckpointProjectKey(projectKeyInput) : null;
    if (selection && !projectKey) throw new CheckpointValidationError("projectKey is required for current selection");
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        WITH provider_matches AS (
          SELECT checkpoint_id AS id, project_key AS "projectKey" FROM checkpoint_project_provider_refs
          WHERE provider = ${provider} AND native_task_id = ${nativeTaskId} ${selection ? sql`AND is_current` : sql``}
          ${selection ? sql`` : sql`UNION
          SELECT cpr.checkpoint_id AS id, wc.project_key AS "projectKey" FROM checkpoint_provider_refs cpr
          JOIN work_checkpoints wc ON wc.id = cpr.checkpoint_id
          WHERE cpr.provider = ${provider} AND cpr.native_task_id = ${nativeTaskId}`}
        )
        SELECT pm.id, pm."projectKey", wc.state FROM provider_matches pm JOIN work_checkpoints wc ON wc.id = pm.id
        WHERE (${projectKey}::text IS NULL OR pm."projectKey" = ${projectKey})
        ORDER BY pm."projectKey", pm.id LIMIT 21
      `) as unknown as Array<{ id: string; projectKey: string; state: string }>;
      if (rows.length > 1) throw new CheckpointAmbiguityError(rows.slice(0, 20));
      return rows[0] ? getWith(tx, rows[0].id) : null;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  function exactKeys(input: SaveCheckpointInput, allowed: string[]): void {
    const extra = Object.keys(input).filter((key) => !allowed.includes(key));
    if (extra.length) throw new CheckpointValidationError(`fields not allowed in ${input.mode} mode: ${extra.join(", ")}`);
  }

  async function explicitIdentityCommand(input: SaveCheckpointInput): Promise<CheckpointRecord> {
    const isCreate = input.mode === "create";
    exactKeys(input, ["mode", "checkpointId", "projectKey", "providerRef", isCreate ? "objective" : "expectedCurrentCheckpointId"]);
    const id = uuid(input.checkpointId ?? "", "checkpointId");
    const projectKey = canonicalizeCheckpointProjectKey(input.projectKey);
    const providerRef = normalizeProviderRef(input.providerRef);
    const objective = isCreate ? requiredText(input.objective, "objective", 20_000) : "";
    if (!isCreate && !Object.hasOwn(input, "expectedCurrentCheckpointId")) throw new CheckpointValidationError("expectedCurrentCheckpointId is required, including explicit null");
    const expected = input.expectedCurrentCheckpointId == null ? null : uuid(input.expectedCurrentCheckpointId, "expectedCurrentCheckpointId");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(["bodhi-checkpoint-binding", providerRef.provider, providerRef.nativeTaskId, projectKey])}))`);
      const existing = await tx.execute(sql`SELECT ${SELECT_CHECKPOINT} FROM work_checkpoints WHERE id = ${id}::uuid FOR UPDATE`) as unknown as CheckpointRow[];
      const bindings = await tx.execute(sql`
        SELECT checkpoint_id FROM checkpoint_project_provider_refs WHERE checkpoint_id = ${id}::uuid
          AND project_key = ${projectKey} AND provider = ${providerRef.provider} AND native_task_id = ${providerRef.nativeTaskId}
        UNION SELECT cpr.checkpoint_id FROM checkpoint_provider_refs cpr JOIN work_checkpoints wc ON wc.id = cpr.checkpoint_id
          WHERE cpr.checkpoint_id = ${id}::uuid AND wc.project_key = ${projectKey}
            AND cpr.provider = ${providerRef.provider} AND cpr.native_task_id = ${providerRef.nativeTaskId}
      `) as unknown as Array<{ checkpoint_id: string }>;
      if (isCreate) {
        if (existing[0]) {
          if (existing[0].projectKey !== projectKey || existing[0].objective !== objective || bindings.length !== 1) {
            throw new CheckpointConflictError("checkpoint UUID already identifies a different outcome or provider binding");
          }
          return (await getWith(tx, id))!;
        }
        const fields = { schemaVersion: CHECKPOINT_SCHEMA_VERSION, projectKey, objective, summary: "", state: "active" as const,
          decisions: [], nextActions: [], entityIds: [], parentCheckpointId: null, goalId: null, opportunityId: null,
          patternKey: null, outcomeMetrics: null, remainingWorkDisposition: null, completionVerificationState: null, completionReceiptIds: null };
        await tx.execute(sql`
          INSERT INTO work_checkpoints (id, schema_version, project_key, objective, summary, state, content_hash)
          VALUES (${id}::uuid, ${CHECKPOINT_SCHEMA_VERSION}, ${projectKey}, ${objective}, '', 'active', ${hashCheckpointContent(checkpointHashFields(fields))})
        `);
        await tx.execute(sql`
          INSERT INTO checkpoint_project_provider_refs(checkpoint_id, project_key, provider, native_task_id, host_id, working_directory, task_url, is_primary)
          VALUES (${id}::uuid, ${projectKey}, ${providerRef.provider}, ${providerRef.nativeTaskId}, ${providerRef.hostId}, ${providerRef.workingDirectory}, ${providerRef.taskUrl}, ${providerRef.isPrimary})
        `);
      } else {
        if (!existing[0] || existing[0].projectKey !== projectKey || bindings.length !== 1) throw new CheckpointNotFoundError("exact checkpoint binding not found");
        const projectBinding = await tx.execute(sql`SELECT id FROM checkpoint_project_provider_refs WHERE checkpoint_id = ${id}::uuid
          AND project_key = ${projectKey} AND provider = ${providerRef.provider} AND native_task_id = ${providerRef.nativeTaskId}`) as unknown[];
        if (!projectBinding.length) throw new CheckpointConflictError("legacy binding has no current-selection field; retain exact UUID access until its reviewed binding migration");
        const selected = await tx.execute(sql`SELECT checkpoint_id AS id FROM checkpoint_project_provider_refs
          WHERE provider = ${providerRef.provider} AND native_task_id = ${providerRef.nativeTaskId} AND project_key = ${projectKey} AND is_current FOR UPDATE`) as unknown as Array<{ id: string }>;
        if (selected[0]?.id === id) return (await getWith(tx, id))!;
        if ((selected[0]?.id ?? null) !== expected) throw new CheckpointConflictError("current checkpoint selection changed");
        await tx.execute(sql`UPDATE checkpoint_project_provider_refs SET is_current = false, updated_at = now()
          WHERE provider = ${providerRef.provider} AND native_task_id = ${providerRef.nativeTaskId} AND project_key = ${projectKey} AND is_current`);
        await tx.execute(sql`UPDATE checkpoint_project_provider_refs SET is_current = true, updated_at = now()
          WHERE checkpoint_id = ${id}::uuid AND project_key = ${projectKey} AND provider = ${providerRef.provider} AND native_task_id = ${providerRef.nativeTaskId}`);
      }
      return (await getWith(tx, id))!;
    });
  }

  async function save(input: SaveCheckpointInput): Promise<CheckpointRecord> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new CheckpointValidationError("checkpoint body must be an object");
    }
    if (input.mode !== undefined && !["create", "update", "select"].includes(input.mode)) throw new CheckpointValidationError("mode must be create, update, or select");
    if (input.mode === "create" || input.mode === "select") {
      try { return await explicitIdentityCommand(input); }
      catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
        if (code === "23505") throw new CheckpointConflictError("checkpoint UUID or binding already identifies another outcome");
        throw error;
      }
    }
    if (!input.mode && (input.checkpointId !== undefined || input.expectedContentHash !== undefined || input.expectedCurrentCheckpointId !== undefined)) {
      throw new CheckpointValidationError("explicit identity fields require an explicit mode");
    }
    const explicitId = input.mode === "update" ? uuid(input.checkpointId ?? "", "checkpointId") : null;
    if (explicitId && (!input.expectedContentHash || !SHA256_RE.test(input.expectedContentHash))) throw new CheckpointValidationError("update requires expectedContentHash SHA-256");
    const projectKey = canonicalizeCheckpointProjectKey(input.projectKey);
    const objective = requiredText(input.objective, "objective", 20_000);
    const summary = optionalText(input.summary, "summary", 100_000) ?? "";
    const state = input.state ?? "active";
    if (!["active", "paused", "abandoned"].includes(state)) {
      throw new CheckpointValidationError("save state must be active, paused, or abandoned; use complete for completion");
    }
    const decisions = normalizeDecisions(input.decisions);
    const nextActions = normalizeNextActions(input.nextActions);
    const entityIds = normalizeEntityIds(input.entityIds);
    // Interpolating a JS array directly into drizzle sql`` expands an empty
    // array to `()`, which is invalid SQL (`()::uuid[]`). Every value has
    // already passed strict UUID validation, so a bound Postgres array literal
    // is both safe and correct for empty and populated arrays.
    const entityIdsPg = `{${entityIds.join(",")}}`;
    const parentCheckpointId = input.parentCheckpointId ? uuid(input.parentCheckpointId, "parentCheckpointId") : null;
    const goalIdProvided = input.goalId !== undefined;
    const opportunityIdProvided = input.opportunityId !== undefined;
    const patternKeyProvided = input.patternKey !== undefined;
    const requestedGoalId = input.goalId ? uuid(input.goalId, "goalId") : null;
    const requestedOpportunityId = input.opportunityId ? uuid(input.opportunityId, "opportunityId") : null;
    const requestedPatternKey = normalizePatternKey(input.patternKey);
    const providerRef = normalizeProviderRef(input.providerRef);

    let checkpointId: string;
    try {
      checkpointId = await db.transaction(async (tx) => {
        // Parent changes are rare and correctness dominates throughput. A
        // transaction-scoped graph lock prevents concurrent A→B / B→A write
        // skew from creating a cycle after both lineage reads pass.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-parent-graph'))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
        // Serialize one provider-task-project identity so two concurrent first
        // saves cannot create competing checkpoints before the unique binding
        // is visible. The native task may still bind another project under a
        // different lock key.
        const bindingLockKey = [
          "bodhi-checkpoint-binding",
          providerRef.provider,
          providerRef.nativeTaskId,
          projectKey,
        ];
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(bindingLockKey)}))`);
        const existingRows = (await tx.execute(sql`
          SELECT wc.id, wc.project_key AS "projectKey", wc.state, wc.objective, wc.schema_version AS "schemaVersion", wc.content_hash AS "contentHash",
            wc.goal_id AS "goalId", wc.opportunity_id AS "opportunityId",
            wc.pattern_key AS "patternKey", bindings."bindingSource"
          FROM (
            SELECT checkpoint_id, 'project'::text AS "bindingSource"
            FROM checkpoint_project_provider_refs
            WHERE provider = ${providerRef.provider}
              AND native_task_id = ${providerRef.nativeTaskId}
              AND project_key = ${projectKey}
            UNION ALL
            SELECT cpr.checkpoint_id, 'legacy'::text AS "bindingSource"
            FROM checkpoint_provider_refs cpr
            JOIN work_checkpoints legacy_wc ON legacy_wc.id = cpr.checkpoint_id
            WHERE cpr.provider = ${providerRef.provider}
              AND cpr.native_task_id = ${providerRef.nativeTaskId}
              AND legacy_wc.project_key = ${projectKey}
          ) bindings
          JOIN work_checkpoints wc ON wc.id = bindings.checkpoint_id
          WHERE (${explicitId}::uuid IS NULL OR wc.id = ${explicitId}::uuid)
          ORDER BY CASE bindings."bindingSource" WHEN 'project' THEN 0 ELSE 1 END
          LIMIT 101
          FOR UPDATE OF wc
        `)) as unknown as Array<{
          id: string; projectKey: string; state: CheckpointState; objective: string; schemaVersion: number; contentHash: string;
          goalId: string | null; opportunityId: string | null; patternKey: string | null;
          bindingSource: "project" | "legacy";
        }>;
        const distinct = [...new Map(existingRows.map((row) => [row.id, row])).values()];
        if (distinct.length > 1) throw new CheckpointAmbiguityError(distinct.slice(0, 20));
        const existing = distinct[0];
        if (explicitId && !existing) throw new CheckpointNotFoundError("exact checkpoint/provider/project binding not found");
        if (explicitId && existing.contentHash !== input.expectedContentHash?.toLowerCase()) throw new CheckpointConflictError("checkpoint content changed; reload before updating");
        if (existing?.schemaVersion >= 3 && existing.objective !== objective) throw new CheckpointConflictError("outcome objective is immutable; create a new checkpoint");
        const schemaVersion = explicitId ? CHECKPOINT_SCHEMA_VERSION : existing?.schemaVersion ?? 2;
        const goalId = goalIdProvided ? requestedGoalId : existing?.goalId ?? null;
        const opportunityId = opportunityIdProvided
          ? requestedOpportunityId
          : existing?.opportunityId ?? null;
        const patternKey = patternKeyProvided ? requestedPatternKey : existing?.patternKey ?? null;

        if (existing && (existing.state === "completed" || existing.state === "abandoned")) {
          throw new CheckpointConflictError(`checkpoint is terminal (${existing.state})`);
        }
        if (existing?.goalId && existing.goalId !== goalId) {
          throw new CheckpointConflictError("goalId is immutable once linked");
        }
        if (existing?.opportunityId && existing.opportunityId !== opportunityId) {
          throw new CheckpointConflictError("opportunityId is immutable once linked");
        }
        if (existing?.patternKey && existing.patternKey !== patternKey) {
          throw new CheckpointConflictError("patternKey is immutable once linked");
        }

        if (goalId) {
          const goals = await tx.execute(sql`
            SELECT project_key AS "projectKey", status FROM personal_goals
            WHERE id = ${goalId}::uuid LIMIT 1
          `) as unknown as Array<{ projectKey: string; status: string }>;
          if (!goals[0]) throw new CheckpointValidationError("goalId does not exist");
          if (goals[0].projectKey !== projectKey) {
            throw new CheckpointValidationError("goalId belongs to a different project");
          }
          if (["completed", "abandoned"].includes(goals[0].status)) {
            throw new CheckpointConflictError(`goal is terminal (${goals[0].status})`);
          }
        }
        if (opportunityId) {
          const opportunities = await tx.execute(sql`
            SELECT project_key AS "projectKey", goal_id AS "goalId", status,
              checkpoint_id AS "checkpointId"
            FROM personal_opportunities WHERE id = ${opportunityId}::uuid LIMIT 1 FOR UPDATE
          `) as unknown as Array<{
            projectKey: string; goalId: string | null; status: string; checkpointId: string | null;
          }>;
          const opportunity = opportunities[0];
          if (!opportunity) throw new CheckpointValidationError("opportunityId does not exist");
          if (opportunity.projectKey !== projectKey) {
            throw new CheckpointValidationError("opportunityId belongs to a different project");
          }
          if (!["open", "accepted", "in_progress"].includes(opportunity.status)) {
            throw new CheckpointConflictError(`opportunity cannot be linked from ${opportunity.status}`);
          }
          if (opportunity.goalId && goalId && opportunity.goalId !== goalId) {
            throw new CheckpointValidationError("goalId does not match the opportunity goal");
          }
          if (opportunity.checkpointId && opportunity.checkpointId !== existing?.id) {
            throw new CheckpointConflictError("opportunity is already linked to another checkpoint");
          }
        }
        if (parentCheckpointId && parentCheckpointId === existing?.id) {
          throw new CheckpointValidationError("a checkpoint cannot be its own parent");
        }
        if (parentCheckpointId) {
          const parentRows = await tx.execute(sql`
            SELECT id, project_key AS "projectKey"
            FROM work_checkpoints WHERE id = ${parentCheckpointId}::uuid LIMIT 1
          `) as unknown as Array<{ id: string; projectKey: string }>;
          if (!parentRows[0]) throw new CheckpointValidationError("parentCheckpointId does not exist");
          if (parentRows[0].projectKey !== projectKey) {
            throw new CheckpointValidationError("parent checkpoint must belong to the same project");
          }
          if (existing) {
            const cycleRows = await tx.execute(sql`
              WITH RECURSIVE lineage AS (
                SELECT id, parent_checkpoint_id
                FROM work_checkpoints WHERE id = ${parentCheckpointId}::uuid
                UNION ALL
                SELECT wc.id, wc.parent_checkpoint_id
                FROM work_checkpoints wc
                JOIN lineage l ON wc.id = l.parent_checkpoint_id
              )
              SELECT id FROM lineage WHERE id = ${existing.id}::uuid LIMIT 1
            `) as unknown as Array<{ id: string }>;
            if (cycleRows[0]) throw new CheckpointValidationError("parentCheckpointId would create a cycle");
          }
        }

        const contentHash = hashCheckpointContent(checkpointHashFields({
          schemaVersion,
          projectKey,
          objective,
          summary,
          state,
          decisions,
          nextActions,
          entityIds,
          parentCheckpointId,
          goalId,
          opportunityId,
          patternKey,
          outcomeMetrics: null,
          remainingWorkDisposition: state === "abandoned" ? "abandoned" : null,
          completionVerificationState: null,
          completionReceiptIds: null,
        }));

        let id = existing?.id;
        if (id) {
          await tx.execute(sql`
            UPDATE work_checkpoints
            SET schema_version = ${schemaVersion},
              objective = ${objective}, summary = ${summary}, state = ${state},
              decisions = ${JSON.stringify(decisions)}::jsonb,
              next_actions = ${JSON.stringify(nextActions)}::jsonb,
              entity_ids = ${entityIdsPg}::uuid[],
              parent_checkpoint_id = ${parentCheckpointId}::uuid,
              goal_id = ${goalId}::uuid,
              opportunity_id = ${opportunityId}::uuid,
              pattern_key = ${patternKey},
              outcome_metrics = NULL,
              remaining_work_disposition = ${state === "abandoned" ? "abandoned" : null},
              completion_verification_state = NULL,
              completion_receipt_ids = NULL,
              content_hash = ${contentHash}, updated_at = now(),
              completed_at = NULL
            WHERE id = ${id}::uuid
          `);
        } else {
          const inserted = await tx.execute(sql`
            INSERT INTO work_checkpoints (
              schema_version, project_key, objective, summary, state, decisions,
              next_actions, entity_ids, parent_checkpoint_id,
              goal_id, opportunity_id, pattern_key, outcome_metrics,
              remaining_work_disposition, content_hash
            ) VALUES (
              ${schemaVersion}, ${projectKey}, ${objective}, ${summary}, ${state},
              ${JSON.stringify(decisions)}::jsonb, ${JSON.stringify(nextActions)}::jsonb,
              ${entityIdsPg}::uuid[], ${parentCheckpointId}::uuid,
              ${goalId}::uuid, ${opportunityId}::uuid, ${patternKey}, NULL,
              ${state === "abandoned" ? "abandoned" : null}, ${contentHash}
            ) RETURNING id
          `) as unknown as Array<{ id: string }>;
          id = inserted[0]?.id;
          if (!id) throw new Error("checkpoint insert returned no id");
        }

        // Existing legacy refs are read-only; preserve their exact provenance.
        if (existing?.bindingSource !== "legacy") {
          if (providerRef.isPrimary) {
            await tx.execute(sql`UPDATE checkpoint_project_provider_refs SET is_primary = false, updated_at = now()
              WHERE checkpoint_id = ${id}::uuid AND provider = ${providerRef.provider} AND native_task_id <> ${providerRef.nativeTaskId}`);
          }
          await tx.execute(sql`
            INSERT INTO checkpoint_project_provider_refs (checkpoint_id, project_key, provider, native_task_id, host_id, working_directory, task_url, is_primary)
            VALUES (${id}::uuid, ${projectKey}, ${providerRef.provider}, ${providerRef.nativeTaskId}, ${providerRef.hostId}, ${providerRef.workingDirectory}, ${providerRef.taskUrl}, ${providerRef.isPrimary})
            ON CONFLICT (provider, native_task_id, project_key, checkpoint_id) DO UPDATE SET
              host_id = EXCLUDED.host_id, working_directory = EXCLUDED.working_directory, task_url = EXCLUDED.task_url,
              is_primary = EXCLUDED.is_primary, updated_at = now()
          `);
        }
        // Unbound learning evidence stays unbound; a later save cannot infer its outcome.
        if (opportunityId) {
          await tx.execute(sql`
            UPDATE personal_opportunities SET status = 'in_progress', checkpoint_id = ${id}::uuid,
              updated_at = now(), resolved_at = NULL
            WHERE id = ${opportunityId}::uuid
          `);
        }
        return id;
      });
    } catch (error) {
      if (error instanceof CheckpointValidationError || error instanceof CheckpointConflictError) throw error;
      if ((error as { code?: string })?.code === "23505") {
        throw new CheckpointConflictError(
          "provider task and project reference already belongs to another checkpoint",
        );
      }
      throw error;
    }

    const result = await get(checkpointId);
    if (!result) throw new Error("checkpoint disappeared after save");
    return result;
  }

  async function find(input: FindCheckpointsInput = {}): Promise<Array<CheckpointRow & { effectiveVerification: EffectiveVerification }>> {
    const conditions: SQL[] = [];
    if (input.project) conditions.push(sql`wc.project_key = ${canonicalizeCheckpointProjectKey(input.project)}`);
    if (input.state) {
      if (!["active", "paused", "completed", "abandoned"].includes(input.state)) {
        throw new CheckpointValidationError("state is invalid");
      }
      conditions.push(sql`wc.state = ${input.state}`);
    }
    if (input.objective) conditions.push(sql`wc.objective ILIKE ${`%${input.objective.trim().slice(0, 500)}%`}`);
    if (input.entity) conditions.push(sql`${uuid(input.entity, "entity")}::uuid = ANY(wc.entity_ids)`);
    if (input.providerTaskId) {
      const provider = input.provider ? normalizeProviderRef({ provider: input.provider, nativeTaskId: input.providerTaskId }).provider : null;
      const providerTaskId = requiredText(input.providerTaskId, "providerTaskId", 500);
      conditions.push(sql`(
        EXISTS (
          SELECT 1 FROM checkpoint_project_provider_refs cpr
          WHERE cpr.checkpoint_id = wc.id
            AND cpr.native_task_id = ${providerTaskId}
            ${provider ? sql`AND cpr.provider = ${provider}` : sql``}
        ) OR EXISTS (
          SELECT 1 FROM checkpoint_provider_refs cpr
          WHERE cpr.checkpoint_id = wc.id
            AND cpr.native_task_id = ${providerTaskId}
            ${provider ? sql`AND cpr.provider = ${provider}` : sql``}
        )
      )`);
    } else if (input.provider) {
      const provider = normalizeProviderRef({ provider: input.provider, nativeTaskId: "validation-only" }).provider;
      conditions.push(sql`(
        EXISTS (
          SELECT 1 FROM checkpoint_project_provider_refs cpr
          WHERE cpr.checkpoint_id = wc.id AND cpr.provider = ${provider}
        ) OR EXISTS (
          SELECT 1 FROM checkpoint_provider_refs cpr
          WHERE cpr.checkpoint_id = wc.id AND cpr.provider = ${provider}
        )
      )`);
    }
    if (input.since) {
      const since = requiredText(input.since, "since", 100);
      if (Number.isNaN(Date.parse(since))) throw new CheckpointValidationError("since must be an ISO date");
      conditions.push(sql`wc.updated_at >= ${since}::timestamptz`);
    }
    const limit = Math.max(1, Math.min(100, Number.isFinite(input.limit) ? Number(input.limit) : 20));
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT ${SELECT_CHECKPOINT} FROM work_checkpoints wc ${where}
        ORDER BY wc.updated_at DESC LIMIT ${limit}
      `) as unknown as CheckpointRow[];
      return Promise.all(rows.map(async (row) => ({
        ...row, decisions: row.decisions ?? [], nextActions: row.nextActions ?? [], entityIds: row.entityIds ?? [],
        completionReceiptIds: row.completionReceiptIds ?? null,
        effectiveVerification: (await readEffectiveCompletion(tx, row.id))?.effectiveVerification ?? { state: "unavailable" as const, receiptIds: [] },
      })));
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async function attachArtifact(checkpointId: string, input: AttachArtifactInput): Promise<CheckpointRecord["artifacts"][number]> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new CheckpointValidationError("artifact body must be an object");
    }
    const id = uuid(checkpointId, "checkpoint id");
    const artifactType = requiredText(input.artifactType, "artifactType", 100);
    const uri = requiredText(input.uri, "uri", 4_000);
    const label = optionalText(input.label, "label", 1_000);
    const sha256 = optionalText(input.sha256, "sha256", 64)?.toLowerCase() ?? null;
    if (sha256 && !SHA256_RE.test(sha256)) throw new CheckpointValidationError("sha256 must be 64 hexadecimal characters");
    const metadata = metadataObject(input.metadata);
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      const parents = await tx.execute(sql`SELECT state FROM work_checkpoints WHERE id = ${id}::uuid FOR UPDATE`) as unknown as Array<{ state: string }>;
      if (!parents[0]) throw new CheckpointNotFoundError("checkpoint not found");
      const old = await tx.execute(sql`SELECT id, artifact_type AS "artifactType", uri, label, sha256, metadata, created_at AS "createdAt"
        FROM checkpoint_artifacts WHERE checkpoint_id = ${id}::uuid AND uri = ${uri}`) as unknown as CheckpointRecord["artifacts"];
      if (old[0]) {
        if (hashCheckpointContent({ artifactType, uri, label, sha256, metadata }) === hashCheckpointContent({
          artifactType: old[0].artifactType, uri: old[0].uri, label: old[0].label, sha256: old[0].sha256, metadata: old[0].metadata,
        })) return old[0];
        if (["completed", "abandoned"].includes(parents[0].state)) throw new CheckpointConflictError("terminal checkpoint artifact is immutable; attach a new reference");
      }
      const rows = await tx.execute(sql`
        INSERT INTO checkpoint_artifacts (checkpoint_id, artifact_type, uri, label, sha256, metadata)
        VALUES (${id}::uuid, ${artifactType}, ${uri}, ${label}, ${sha256}, ${JSON.stringify(metadata)}::jsonb)
        ON CONFLICT (checkpoint_id, uri) DO UPDATE SET artifact_type = EXCLUDED.artifact_type,
          label = EXCLUDED.label, sha256 = EXCLUDED.sha256, metadata = EXCLUDED.metadata
        RETURNING id, artifact_type AS "artifactType", uri, label, sha256, metadata, created_at AS "createdAt"
      `) as unknown as CheckpointRecord["artifacts"];
      return rows[0];
    });
  }

  async function recordVerification(checkpointId: string, input: RecordVerificationInput): Promise<CheckpointRecord["verificationReceipts"][number]> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new CheckpointValidationError("verification body must be an object");
    }
    const id = uuid(checkpointId, "checkpoint id");
    const status = input.status ?? "pending";
    if (!["pending", "passed", "failed"].includes(status)) throw new CheckpointValidationError("verification status is invalid");
    const metadata = metadataObject(input.metadata);
    // Cycle receipts are embedded verbatim in the strict contractVersion 3
    // packet, whose verifier caps each verification field at 800 characters.
    // Generic checkpoint receipts retain their wider storage contract.
    const strictCycleReceipt = typeof metadata.cycleId === "string" && metadata.cycleId.trim().length > 0;
    if (strictCycleReceipt) {
      for (const [field, value] of [
        ["claim", input.claim],
        ["expectedSignal", input.expectedSignal],
        ["observedSignal", input.observedSignal],
      ] as const) {
        if (typeof value === "string" && value.length > STRICT_CYCLE_VERIFICATION_TEXT_LIMIT) {
          throw new CheckpointValidationError(`${field} exceeds ${STRICT_CYCLE_VERIFICATION_TEXT_LIMIT} characters`);
        }
      }
    }
    const signalTextLimit = strictCycleReceipt ? STRICT_CYCLE_VERIFICATION_TEXT_LIMIT : 20_000;
    const observedTextLimit = strictCycleReceipt ? STRICT_CYCLE_VERIFICATION_TEXT_LIMIT : 100_000;
    const claim = requiredText(input.claim, "claim", signalTextLimit);
    const expectedSignal = requiredText(input.expectedSignal, "expectedSignal", signalTextLimit);
    const observedSignal = optionalText(input.observedSignal, "observedSignal", observedTextLimit);
    if (status !== "pending" && !observedSignal) {
      throw new CheckpointValidationError("observedSignal is required for passed or failed verification");
    }
    const evidenceSource = requiredText(input.evidenceSource, "evidenceSource", 4_000);
    const lineage = [input.receiptId, input.claimReceiptId, input.subjectRevision, input.supersedesReceiptId].some((field) => field !== undefined);
    if (lineage && (!input.receiptId || !input.claimReceiptId || !input.subjectRevision)) throw new CheckpointValidationError("explicit verification requires receiptId, claimReceiptId and subjectRevision together");
    const receiptId = input.receiptId ? uuid(input.receiptId, "receiptId") : randomUUID();
    const claimReceiptId = input.claimReceiptId ? uuid(input.claimReceiptId, "claimReceiptId") : null;
    const supersedesReceiptId = input.supersedesReceiptId ? uuid(input.supersedesReceiptId, "supersedesReceiptId") : null;
    const subjectRevision = input.subjectRevision?.toLowerCase() ?? null;
    if (subjectRevision && !/^[a-f0-9]{64}$/.test(subjectRevision)) throw new CheckpointValidationError("subjectRevision must be SHA-256");
    if (lineage && !supersedesReceiptId && claimReceiptId !== receiptId) throw new CheckpointValidationError("a first receipt must identify itself as claimReceiptId");
    if (supersedesReceiptId === receiptId) throw new CheckpointValidationError("a receipt cannot supersede itself");
    const observedAt = input.observedAt ?? new Date().toISOString();
    if (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt))) throw new CheckpointValidationError("observedAt must be an ISO date");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      const checkpoints = await tx.execute(sql`SELECT state FROM work_checkpoints WHERE id = ${id}::uuid FOR UPDATE`) as unknown[];
      if (!checkpoints.length) throw new CheckpointNotFoundError("checkpoint not found");
      const all = await tx.execute(sql`SELECT id, claim, expected_signal AS "expectedSignal", observed_signal AS "observedSignal",
        evidence_source AS "evidenceSource", status, observed_at AS "observedAt", metadata, created_at AS "createdAt",
        subject_revision AS "subjectRevision", supersedes_receipt_id AS "supersedesReceiptId"
        FROM verification_receipts WHERE checkpoint_id = ${id}::uuid`) as unknown as CheckpointRecord["verificationReceipts"];
      const replay = all.find((receipt) => receipt.id === receiptId);
      if (replay) {
        const payload = { claim, expectedSignal, observedSignal, evidenceSource, status, metadata, subjectRevision, supersedesReceiptId };
        const previous = { claim: replay.claim, expectedSignal: replay.expectedSignal, observedSignal: replay.observedSignal,
          evidenceSource: replay.evidenceSource, status: replay.status, metadata: replay.metadata, subjectRevision: replay.subjectRevision, supersedesReceiptId: replay.supersedesReceiptId };
        if (hashCheckpointContent(payload) !== hashCheckpointContent(previous) || receiptRoot(receiptId, all) !== claimReceiptId
          || (input.observedAt !== undefined && new Date(replay.observedAt).toISOString() !== new Date(observedAt).toISOString())) {
          throw new CheckpointConflictError("receipt UUID replay changed its immutable payload or lineage");
        }
        return { ...replay, claimReceiptId };
      }
      const reused = await tx.execute(sql`SELECT id FROM verification_receipts WHERE id = ${receiptId}::uuid`) as unknown[];
      if (reused.length) throw new CheckpointConflictError("receipt UUID already belongs to another checkpoint");
      if (supersedesReceiptId) {
        const predecessor = all.find((receipt) => receipt.id === supersedesReceiptId);
        if (!predecessor || !predecessor.subjectRevision || predecessor.subjectRevision !== subjectRevision
          || receiptRoot(supersedesReceiptId, all) !== claimReceiptId) throw new CheckpointConflictError("predecessor is missing or belongs to a different claim, checkpoint, or subject revision");
        if (all.some((receipt) => receipt.supersedesReceiptId === supersedesReceiptId)) throw new CheckpointConflictError("predecessor is stale; supersede the current head");
      }
      const rows = await tx.execute(sql`
        INSERT INTO verification_receipts (id, checkpoint_id, claim, expected_signal, observed_signal,
          evidence_source, status, observed_at, metadata, subject_revision, supersedes_receipt_id)
        VALUES (${receiptId}::uuid, ${id}::uuid, ${claim}, ${expectedSignal}, ${observedSignal}, ${evidenceSource},
          ${status}, ${observedAt}::timestamptz, ${JSON.stringify(metadata)}::jsonb, ${subjectRevision}, ${supersedesReceiptId}::uuid)
        RETURNING id, claim, expected_signal AS "expectedSignal", observed_signal AS "observedSignal",
          evidence_source AS "evidenceSource", status, observed_at AS "observedAt", metadata, created_at AS "createdAt",
          subject_revision AS "subjectRevision", supersedes_receipt_id AS "supersedesReceiptId"
      `) as unknown as CheckpointRecord["verificationReceipts"];
      return { ...rows[0], claimReceiptId };
    });
  }

  async function complete(checkpointId: string, input: CompleteCheckpointInput): Promise<CheckpointRecord> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new CheckpointValidationError("completion body must be an object");
    }
    const id = uuid(checkpointId, "checkpoint id");
    const summary = requiredText(input.summary, "summary", 100_000);
    const outcomeMetrics = normalizeOutcomeMetrics(input.outcomeMetrics);
    if (!["none", "deferred", "abandoned"].includes(input.remainingWorkDisposition)) {
      throw new CheckpointValidationError("remainingWorkDisposition is invalid");
    }
    if (!["passed", "failed", "not-required"].includes(input.verificationState)) {
      throw new CheckpointValidationError("verificationState is invalid");
    }

    let completionReceiptIds: string[] | null = null;
    if (input.completionReceiptIds !== undefined) {
      if (!Array.isArray(input.completionReceiptIds) || input.completionReceiptIds.length > 1000) throw new CheckpointValidationError("completionReceiptIds must be an array of at most 1000 UUIDs");
      completionReceiptIds = input.completionReceiptIds.map((value) => uuid(value, "completionReceiptIds entry")).sort();
      if (new Set(completionReceiptIds).size !== completionReceiptIds.length) throw new CheckpointValidationError("completionReceiptIds must be distinct");
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodhi-checkpoint-evidence'))`);
      const rows = await tx.execute(sql`
        SELECT ${SELECT_CHECKPOINT} FROM work_checkpoints
        WHERE id = ${id}::uuid LIMIT 1 FOR UPDATE
      `) as unknown as CheckpointRow[];
      const existing = rows[0];
      if (!existing) throw new CheckpointNotFoundError("checkpoint not found");
      if (existing.state === "abandoned") throw new CheckpointConflictError("abandoned checkpoint cannot be completed");
      if (existing.state === "completed") {
        if (
          existing.summary === summary
          && existing.remainingWorkDisposition === input.remainingWorkDisposition
          && existing.completionVerificationState === input.verificationState
          && hashCheckpointContent({ metrics: existing.outcomeMetrics ?? null }) === hashCheckpointContent({ metrics: outcomeMetrics })
          && JSON.stringify(existing.completionReceiptIds ?? null) === JSON.stringify(completionReceiptIds)
        ) {
          return; // Exact replay never rewrites terminal history.
        }
        throw new CheckpointConflictError("completed checkpoint is immutable");
      }

      if (existing.schemaVersion >= 3 && completionReceiptIds === null) throw new CheckpointValidationError("completionReceiptIds is required for this outcome");
      if (completionReceiptIds !== null) {
        const receipts = (await getWith(tx, id))!.verificationReceipts;
        if (input.verificationState === "not-required") {
          if (completionReceiptIds.length || receipts.length) throw new CheckpointConflictError("not-required completion requires an empty manifest and zero verification receipts");
        } else {
          if (!completionReceiptIds.length) throw new CheckpointConflictError("passed or failed completion requires an explicit receipt manifest");
          const roots = new Set<string>();
          for (const receiptId of completionReceiptIds) {
            const root = receiptRoot(receiptId, receipts);
            if (!root || roots.has(root) || receipts.some((receipt) => receipt.supersedesReceiptId === receiptId)) throw new CheckpointConflictError("completion manifest requires distinct explicit claims at their current heads");
            roots.add(root);
          }
          const derived = deriveEffectiveVerification({ completionReceiptIds, completionVerificationState: input.verificationState }, receipts);
          if (derived.state !== input.verificationState) throw new CheckpointConflictError(`${input.verificationState} completion does not match its declared receipt manifest`);
        }
      } else {
      if (input.verificationState === "passed" || input.verificationState === "failed") {
        const receiptRows = await tx.execute(sql`
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'passed')::int AS passed,
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM verification_receipts WHERE checkpoint_id = ${id}::uuid
        `) as unknown as Array<{ total: number; passed: number; pending: number; failed: number }>;
        const counts = receiptRows[0] ?? { total: 0, passed: 0, pending: 0, failed: 0 };
        if (input.verificationState === "passed" && (counts.passed < 1 || counts.pending > 0 || counts.failed > 0)) {
          throw new CheckpointConflictError("passed completion requires at least one passed receipt and no pending or failed receipts");
        }
        if (input.verificationState === "failed" && counts.failed < 1) {
          throw new CheckpointConflictError("failed completion requires at least one failed receipt");
        }
      } else {
        const receiptRows = await tx.execute(sql`
          SELECT count(*)::int AS total FROM verification_receipts WHERE checkpoint_id = ${id}::uuid
        `) as unknown as Array<{ total: number }>;
        if ((receiptRows[0]?.total ?? 0) > 0) {
          throw new CheckpointConflictError("not-required completion requires zero verification receipts");
        }
      }

      }

      const nextActions = completionNextActions(existing.nextActions, input.remainingWorkDisposition);
      const contentHash = hashCheckpointContent(checkpointHashFields({
        ...existing,
        schemaVersion: completionReceiptIds !== null ? CHECKPOINT_SCHEMA_VERSION : existing.schemaVersion,
        completionReceiptIds,
        summary,
        state: "completed",
        nextActions,
        remainingWorkDisposition: input.remainingWorkDisposition,
        completionVerificationState: input.verificationState,
        outcomeMetrics,
      }));
      await tx.execute(sql`
        UPDATE work_checkpoints SET
          summary = ${summary}, state = 'completed',
          schema_version = ${completionReceiptIds !== null ? CHECKPOINT_SCHEMA_VERSION : existing.schemaVersion},
          completion_receipt_ids = ${completionReceiptIds === null ? null : `{${completionReceiptIds.join(',')}}`}::uuid[],
          next_actions = ${JSON.stringify(nextActions)}::jsonb,
          remaining_work_disposition = ${input.remainingWorkDisposition},
          completion_verification_state = ${input.verificationState},
          outcome_metrics = ${outcomeMetrics ? JSON.stringify(outcomeMetrics) : null}::jsonb,
          content_hash = ${contentHash}, completed_at = now(), updated_at = now()
        WHERE id = ${id}::uuid
      `);

      const effectivePassed = isEffectivelyPassed(await readEffectiveCompletion(tx, id));
      if (existing.opportunityId) {
        if (effectivePassed) {
          await tx.execute(sql`
            UPDATE personal_opportunities SET status = 'completed',
              resolution_reason = 'linked checkpoint verified', resolved_at = now(), updated_at = now()
            WHERE id = ${existing.opportunityId}::uuid AND checkpoint_id = ${id}::uuid
          `);
        } else {
          await tx.execute(sql`
            UPDATE personal_opportunities SET status = 'accepted', checkpoint_id = NULL,
              resolution_reason = ${input.verificationState === "failed"
                ? "linked checkpoint verification failed"
                : "linked checkpoint did not provide passed verification"},
              resolved_at = NULL, updated_at = now()
            WHERE id = ${existing.opportunityId}::uuid AND checkpoint_id = ${id}::uuid
          `);
        }
      }

      if (
        existing.patternKey
        && effectivePassed
        && outcomeMetrics?.resultDisposition === "accepted"
      ) {
        const candidates = await tx.execute(sql`SELECT id FROM work_checkpoints
          WHERE project_key = ${existing.projectKey} AND pattern_key = ${existing.patternKey}
            AND state = 'completed' AND completion_verification_state = 'passed'
            AND outcome_metrics->>'resultDisposition' = 'accepted' ORDER BY id`) as unknown as Array<{ id: string }>;
        const qualifying: string[] = [];
        for (const candidate of candidates) {
          if (isEffectivelyPassed(await readEffectiveCompletion(tx, candidate.id, true))) qualifying.push(candidate.id);
        }
        if (qualifying.length >= 3) {
          await tx.execute(sql`INSERT INTO workflow_candidates(project_key, pattern_key, summary, qualifying_checkpoint_ids, successful_runs)
            VALUES (${existing.projectKey}, ${existing.patternKey}, ${`Repeated verified workflow: ${existing.patternKey}`}, ${`{${qualifying.join(',')}}`}::uuid[], ${qualifying.length})
            ON CONFLICT(project_key, pattern_key) DO UPDATE SET qualifying_checkpoint_ids = EXCLUDED.qualifying_checkpoint_ids,
              successful_runs = EXCLUDED.successful_runs, updated_at = now()`);
        }
      }
    });

    const result = await get(id);
    if (!result) throw new Error("checkpoint disappeared after completion");
    return result;
  }

  async function reconcileMaintenance(): Promise<CheckpointMaintenanceReport> {
    const activeDays = 14;
    const pendingVerificationDays = 7;
    const rows = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM work_checkpoints
          WHERE state = 'active' AND updated_at < now() - (${activeDays} * interval '1 day')) AS "staleActiveCount",
        (SELECT count(*)::int FROM verification_receipts vr
          WHERE status = 'pending' AND created_at < now() - (${pendingVerificationDays} * interval '1 day')
            AND NOT EXISTS (SELECT 1 FROM verification_receipts successor WHERE successor.supersedes_receipt_id = vr.id)) AS "pendingVerificationCount"
    `) as unknown as Array<{ staleActiveCount: number; pendingVerificationCount: number }>;
    return {
      ok: true,
      staleActiveCount: rows[0]?.staleActiveCount ?? 0,
      pendingVerificationCount: rows[0]?.pendingVerificationCount ?? 0,
      changed: 0,
      readOnly: true,
      thresholds: { activeDays, pendingVerificationDays },
    };
  }

  return { save, get, getByProvider, find, attachArtifact, recordVerification, complete, reconcileMaintenance };
}
