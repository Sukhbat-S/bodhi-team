import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { workCheckpoints } from "./checkpoints.js";

export type SkillScope = "repo" | "user";
export type SkillResultDisposition = "accepted" | "revised" | "discarded" | "failed";
export type SkillVerificationState = "passed" | "failed" | "not-required" | "unverified";
export type SkillSignalType =
  | "correction"
  | "rejection"
  | "workaround"
  | "routing-miss"
  | "missing-context"
  | "stale-reference"
  | "quality-gap"
  | "verification-failure"
  | "safety-failure"
  | "agent-boundary";
export type SkillChangeType = "update" | "split" | "merge" | "retire" | "new-skill" | "agent-evaluation";
export type SkillSignalSeverity = "ordinary" | "material" | "critical";
export type SkillCandidateStatus = "candidate" | "approved" | "dismissed" | "materialized";

export interface SkillCandidateEvidenceSnapshot {
  signalId: string;
  receiptId: string;
  checkpointId?: string | null;
  verificationReceiptIds?: string[];
  provider: string;
  nativeTaskId: string;
  skillHash: string;
  signalType: SkillSignalType;
  severity: SkillSignalSeverity;
  summary: string;
  contentHash: string;
  observedAt: string;
}

export const skillRunReceipts = pgTable(
  "skill_run_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    provider: text("provider").notNull(),
    nativeTaskId: text("native_task_id").notNull(),
    checkpointId: uuid("checkpoint_id").references(() => workCheckpoints.id, { onDelete: "set null" }),
    skillName: text("skill_name").notNull(),
    skillScope: text("skill_scope").$type<SkillScope>().notNull(),
    skillHash: text("skill_hash").notNull(),
    resultDisposition: text("result_disposition").$type<SkillResultDisposition>().notNull(),
    verificationState: text("verification_state").$type<SkillVerificationState>().notNull(),
    externalSkillDependencies: jsonb("external_skill_dependencies").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("skill_run_receipts_scope_chk", sql`${t.skillScope} IN ('repo','user')`),
    check("skill_run_receipts_result_chk", sql`${t.resultDisposition} IN ('accepted','revised','discarded','failed')`),
    check("skill_run_receipts_verification_chk", sql`${t.verificationState} IN ('passed','failed','not-required','unverified')`),
    check("skill_run_receipts_hash_chk", sql`length(${t.skillHash}) = 64`),
    uniqueIndex("skill_run_receipts_bound_uidx")
      .on(t.provider, t.nativeTaskId, t.projectKey, t.skillName, t.skillHash, t.checkpointId).where(sql`${t.checkpointId} IS NOT NULL`),
    uniqueIndex("skill_run_receipts_unbound_uidx")
      .on(t.provider, t.nativeTaskId, t.projectKey, t.skillName, t.skillHash).where(sql`${t.checkpointId} IS NULL`),
    index("skill_run_receipts_skill_completed_idx").on(t.skillName, t.completedAt),
    index("skill_run_receipts_project_completed_idx").on(t.projectKey, t.completedAt),
    index("skill_run_receipts_checkpoint_idx").on(t.checkpointId),
  ],
);

export const skillLearningSignals = pgTable(
  "skill_learning_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id").notNull().references(() => skillRunReceipts.id, { onDelete: "cascade" }),
    signalType: text("signal_type").$type<SkillSignalType>().notNull(),
    learningKey: text("learning_key").notNull(),
    changeType: text("change_type").$type<SkillChangeType>().notNull(),
    severity: text("severity").$type<SkillSignalSeverity>().notNull(),
    summary: text("summary").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("skill_learning_signals_type_chk", sql`${t.signalType} IN ('correction','rejection','workaround','routing-miss','missing-context','stale-reference','quality-gap','verification-failure','safety-failure','agent-boundary')`),
    check("skill_learning_signals_change_chk", sql`${t.changeType} IN ('update','split','merge','retire','new-skill','agent-evaluation')`),
    check("skill_learning_signals_severity_chk", sql`${t.severity} IN ('ordinary','material','critical')`),
    check("skill_learning_signals_hash_chk", sql`length(${t.contentHash}) = 64`),
    uniqueIndex("skill_learning_signals_receipt_key_uidx")
      .on(t.receiptId, t.signalType, t.learningKey, t.contentHash),
    index("skill_learning_signals_pattern_idx").on(t.learningKey, t.changeType, t.createdAt),
  ],
);

export const skillLearningCandidates = pgTable(
  "skill_learning_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    targetSkill: text("target_skill").notNull(),
    changeType: text("change_type").$type<SkillChangeType>().notNull(),
    learningKey: text("learning_key").notNull(),
    title: text("title").notNull(),
    proposedChange: text("proposed_change").notNull(),
    severity: text("severity").$type<SkillSignalSeverity>().notNull(),
    status: text("status").$type<SkillCandidateStatus>().notNull().default("candidate"),
    occurrenceCount: integer("occurrence_count").notNull(),
    evidenceSnapshots: jsonb("evidence_snapshots").$type<SkillCandidateEvidenceSnapshot[]>().notNull().default(sql`'[]'::jsonb`),
    resolutionReason: text("resolution_reason"),
    materializedCheckpointId: uuid("materialized_checkpoint_id").references(() => workCheckpoints.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check("skill_learning_candidates_change_chk", sql`${t.changeType} IN ('update','split','merge','retire','new-skill','agent-evaluation')`),
    check("skill_learning_candidates_severity_chk", sql`${t.severity} IN ('ordinary','material','critical')`),
    check("skill_learning_candidates_status_chk", sql`${t.status} IN ('candidate','approved','dismissed','materialized')`),
    check("skill_learning_candidates_occurrences_chk", sql`${t.occurrenceCount} >= 1`),
    uniqueIndex("skill_learning_candidates_pattern_uidx")
      .on(t.projectKey, t.targetSkill, t.changeType, t.learningKey),
    index("skill_learning_candidates_status_idx").on(t.status, t.severity, t.updatedAt),
  ],
);

export const skillUsageRollups = pgTable(
  "skill_usage_rollups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    skillName: text("skill_name").notNull(),
    skillHash: text("skill_hash").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    taskUses: integer("task_uses").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    revisedCount: integer("revised_count").notNull().default(0),
    discardedCount: integer("discarded_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    correctionCount: integer("correction_count").notNull().default(0),
    workaroundCount: integer("workaround_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("skill_usage_rollups_hash_chk", sql`length(${t.skillHash}) = 64`),
    check("skill_usage_rollups_counts_chk", sql`${t.taskUses} >= 0 AND ${t.acceptedCount} >= 0 AND ${t.revisedCount} >= 0 AND ${t.discardedCount} >= 0 AND ${t.failedCount} >= 0 AND ${t.correctionCount} >= 0 AND ${t.workaroundCount} >= 0`),
    uniqueIndex("skill_usage_rollups_period_uidx")
      .on(t.projectKey, t.skillName, t.skillHash, t.periodStart),
    index("skill_usage_rollups_skill_period_idx").on(t.skillName, t.periodStart),
  ],
);

export type SkillRunReceipt = InferSelectModel<typeof skillRunReceipts>;
export type NewSkillRunReceipt = InferInsertModel<typeof skillRunReceipts>;
export type SkillLearningSignal = InferSelectModel<typeof skillLearningSignals>;
export type NewSkillLearningSignal = InferInsertModel<typeof skillLearningSignals>;
export type SkillLearningCandidate = InferSelectModel<typeof skillLearningCandidates>;
export type NewSkillLearningCandidate = InferInsertModel<typeof skillLearningCandidates>;
export type SkillUsageRollup = InferSelectModel<typeof skillUsageRollups>;
export type NewSkillUsageRollup = InferInsertModel<typeof skillUsageRollups>;
