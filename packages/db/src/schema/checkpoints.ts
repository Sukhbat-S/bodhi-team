// ============================================================
// BODHI 1.0 — Provider-neutral work checkpoints
//
// Checkpoints are the durable continuity boundary between BODHI's canonical
// truth store and whichever execution harness is active. Provider task IDs are
// references, never the primary identity of the work itself.
// Migration: packages/db/src/migrations/apply-work-checkpoints.ts
// ============================================================

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  check,
  foreignKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export type CheckpointState = "active" | "paused" | "completed" | "abandoned";
export type CompletionVerificationState = "passed" | "failed" | "not-required";
export type RemainingWorkDisposition = "none" | "deferred" | "abandoned";
export type VerificationReceiptStatus = "pending" | "passed" | "failed";
export type CheckpointResultDisposition = "accepted" | "revised" | "discarded";

export interface CheckpointOutcomeMetrics {
  resultDisposition: CheckpointResultDisposition;
  reviewMinutes?: number;
  reworkCount?: number;
  completedWorkerOutcomes?: number;
  computeCostUsd?: number;
}

export interface CheckpointDecision {
  text: string;
  madeAt?: string;
  rationale?: string;
}

export interface CheckpointNextAction {
  text: string;
  status?: "pending" | "done" | "dropped";
  owner?: string;
}

export const workCheckpoints = pgTable(
  "work_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schemaVersion: integer("schema_version").notNull().default(2),
    projectKey: text("project_key").notNull(),
    objective: text("objective").notNull(),
    summary: text("summary").notNull().default(""),
    state: text("state").$type<CheckpointState>().notNull().default("active"),
    decisions: jsonb("decisions").$type<CheckpointDecision[]>().notNull().default(sql`'[]'::jsonb`),
    nextActions: jsonb("next_actions").$type<CheckpointNextAction[]>().notNull().default(sql`'[]'::jsonb`),
    entityIds: uuid("entity_ids").array().notNull().default(sql`'{}'::uuid[]`),
    parentCheckpointId: uuid("parent_checkpoint_id").references(
      (): AnyPgColumn => workCheckpoints.id,
      { onDelete: "set null" },
    ),
    goalId: uuid("goal_id"),
    opportunityId: uuid("opportunity_id"),
    patternKey: text("pattern_key"),
    outcomeMetrics: jsonb("outcome_metrics").$type<CheckpointOutcomeMetrics>(),
    remainingWorkDisposition: text("remaining_work_disposition").$type<RemainingWorkDisposition>(),
    completionVerificationState: text("completion_verification_state").$type<CompletionVerificationState>(),
    completionReceiptIds: uuid("completion_receipt_ids").array(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("work_checkpoints_schema_version_chk", sql`${t.schemaVersion} > 0`),
    check("work_checkpoints_state_chk", sql`${t.state} IN ('active','paused','completed','abandoned')`),
    check("work_checkpoints_content_hash_chk", sql`length(${t.contentHash}) = 64`),
    check(
      "work_checkpoints_remaining_disposition_chk",
      sql`${t.remainingWorkDisposition} IS NULL OR ${t.remainingWorkDisposition} IN ('none','deferred','abandoned')`,
    ),
    check(
      "work_checkpoints_completion_verification_chk",
      sql`${t.completionVerificationState} IS NULL OR ${t.completionVerificationState} IN ('passed','failed','not-required')`,
    ),
    check(
      "work_checkpoints_completion_fields_chk",
      sql`(${t.state} <> 'completed') OR (${t.completedAt} IS NOT NULL AND ${t.remainingWorkDisposition} IS NOT NULL AND ${t.completionVerificationState} IS NOT NULL)`,
    ),
    index("work_checkpoints_project_state_idx").on(t.projectKey, t.state, t.updatedAt),
    uniqueIndex("work_checkpoints_id_project_uidx").on(t.id, t.projectKey),
    index("work_checkpoints_updated_at_idx").on(t.updatedAt),
    index("work_checkpoints_entity_ids_gin_idx").using("gin", t.entityIds),
  ],
);

export const checkpointProviderRefs = pgTable(
  "checkpoint_provider_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => workCheckpoints.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    nativeTaskId: text("native_task_id").notNull(),
    hostId: text("host_id"),
    workingDirectory: text("working_directory"),
    taskUrl: text("task_url"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("checkpoint_provider_refs_native_uidx").on(t.provider, t.nativeTaskId),
    uniqueIndex("checkpoint_provider_refs_primary_provider_uidx")
      .on(t.checkpointId, t.provider)
      .where(sql`${t.isPrimary} = true`),
    index("checkpoint_provider_refs_checkpoint_idx").on(t.checkpointId),
  ],
);

// New provider bindings are project-scoped so one native task can preserve
// independent continuity for more than one explicitly scoped project. The
// original checkpoint_provider_refs table remains a read-only compatibility
// source for bindings created before this capability existed.
export const checkpointProjectProviderRefs = pgTable(
  "checkpoint_project_provider_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkpointId: uuid("checkpoint_id").notNull(),
    projectKey: text("project_key").notNull(),
    provider: text("provider").notNull(),
    nativeTaskId: text("native_task_id").notNull(),
    hostId: text("host_id"),
    workingDirectory: text("working_directory"),
    taskUrl: text("task_url"),
    isPrimary: boolean("is_primary").notNull().default(true),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.checkpointId, t.projectKey],
      foreignColumns: [workCheckpoints.id, workCheckpoints.projectKey],
      name: "checkpoint_project_provider_refs_checkpoint_project_fkey",
    }).onDelete("cascade"),
    uniqueIndex("checkpoint_project_provider_refs_outcome_uidx")
      .on(t.provider, t.nativeTaskId, t.projectKey, t.checkpointId),
    uniqueIndex("checkpoint_project_provider_refs_current_uidx")
      .on(t.provider, t.nativeTaskId, t.projectKey).where(sql`${t.isCurrent} = true`),
    uniqueIndex("checkpoint_project_provider_refs_primary_provider_uidx")
      .on(t.checkpointId, t.provider)
      .where(sql`${t.isPrimary} = true`),
    index("checkpoint_project_provider_refs_checkpoint_idx").on(t.checkpointId),
  ],
);

export const checkpointArtifacts = pgTable(
  "checkpoint_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => workCheckpoints.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    uri: text("uri").notNull(),
    label: text("label"),
    sha256: text("sha256"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("checkpoint_artifacts_sha256_chk", sql`${t.sha256} IS NULL OR length(${t.sha256}) = 64`),
    uniqueIndex("checkpoint_artifacts_checkpoint_uri_uidx").on(t.checkpointId, t.uri),
    index("checkpoint_artifacts_checkpoint_idx").on(t.checkpointId),
  ],
);

export const verificationReceipts = pgTable(
  "verification_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkpointId: uuid("checkpoint_id")
      .notNull()
      .references(() => workCheckpoints.id, { onDelete: "cascade" }),
    supersedesReceiptId: uuid("supersedes_receipt_id"),
    subjectRevision: text("subject_revision"),
    claim: text("claim").notNull(),
    expectedSignal: text("expected_signal").notNull(),
    observedSignal: text("observed_signal"),
    evidenceSource: text("evidence_source").notNull(),
    status: text("status").$type<VerificationReceiptStatus>().notNull().default("pending"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("verification_receipts_status_chk", sql`${t.status} IN ('pending','passed','failed')`),
    check(
      "verification_receipts_observed_signal_chk",
      sql`${t.status} = 'pending' OR ${t.observedSignal} IS NOT NULL`,
    ),
    uniqueIndex("verification_receipts_id_checkpoint_uidx").on(t.id, t.checkpointId),
    uniqueIndex("verification_receipts_successor_uidx").on(t.supersedesReceiptId).where(sql`${t.supersedesReceiptId} IS NOT NULL`),
    foreignKey({ columns: [t.supersedesReceiptId, t.checkpointId], foreignColumns: [t.id, t.checkpointId], name: "verification_receipts_predecessor_checkpoint_fkey" }),
    check("verification_receipts_lineage_chk", sql`(${t.subjectRevision} IS NULL OR ${t.subjectRevision} ~ '^[a-f0-9]{64}$') AND (${t.supersedesReceiptId} IS NULL OR (${t.supersedesReceiptId} <> ${t.id} AND ${t.subjectRevision} IS NOT NULL))`),
    index("verification_receipts_checkpoint_idx").on(t.checkpointId),
    index("verification_receipts_pending_idx").on(t.status, t.observedAt),
  ],
);

export type WorkCheckpoint = InferSelectModel<typeof workCheckpoints>;
export type NewWorkCheckpoint = InferInsertModel<typeof workCheckpoints>;
export type CheckpointProviderRef = InferSelectModel<typeof checkpointProviderRefs>;
export type NewCheckpointProviderRef = InferInsertModel<typeof checkpointProviderRefs>;
export type CheckpointProjectProviderRef = InferSelectModel<typeof checkpointProjectProviderRefs>;
export type NewCheckpointProjectProviderRef = InferInsertModel<typeof checkpointProjectProviderRefs>;
export type CheckpointArtifact = InferSelectModel<typeof checkpointArtifacts>;
export type NewCheckpointArtifact = InferInsertModel<typeof checkpointArtifacts>;
export type VerificationReceipt = InferSelectModel<typeof verificationReceipts>;
export type NewVerificationReceipt = InferInsertModel<typeof verificationReceipts>;
