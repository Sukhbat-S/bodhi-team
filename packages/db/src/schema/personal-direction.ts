import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export type PersonalGoalStatus = "active" | "paused" | "completed" | "abandoned";
export type GoalReviewCadence = "weekly" | "quarterly";
export type GoalAssessment = "on-track" | "at-risk" | "blocked" | "complete";
export type OpportunityStatus = "open" | "accepted" | "in_progress" | "parked" | "dismissed" | "completed";
export type DirectionLevel = "low" | "medium" | "high";
export type WorkflowCandidateStatus = "candidate" | "approved" | "dismissed" | "materialized";

export interface ObservationScope {
  kind: "project" | "path";
  ref: string;
  purpose: string;
}

export interface DirectionEvidence {
  sourceKind: "file" | "goal" | "checkpoint" | "memory" | "parking" | "verification" | "activity" | "other";
  reference: string;
  observedAt: string;
  sha256: string;
  summary: string;
}

export const personalGoals = pgTable(
  "personal_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    title: text("title").notNull(),
    outcome: text("outcome").notNull(),
    successCriteria: jsonb("success_criteria").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    constraints: jsonb("constraints").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    priority: integer("priority").notNull().default(3),
    status: text("status").$type<PersonalGoalStatus>().notNull().default("active"),
    targetDate: timestamp("target_date", { withTimezone: true }),
    observationScopes: jsonb("observation_scopes").$type<ObservationScope[]>().notNull().default(sql`'[]'::jsonb`),
    lastWeeklyReviewAt: timestamp("last_weekly_review_at", { withTimezone: true }),
    lastQuarterlyReviewAt: timestamp("last_quarterly_review_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("personal_goals_priority_chk", sql`${t.priority} BETWEEN 1 AND 5`),
    check("personal_goals_status_chk", sql`${t.status} IN ('active','paused','completed','abandoned')`),
    index("personal_goals_project_status_idx").on(t.projectKey, t.status, t.priority),
    index("personal_goals_review_idx").on(t.lastWeeklyReviewAt, t.lastQuarterlyReviewAt),
  ],
);

export const goalReviews = pgTable(
  "goal_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id").notNull().references(() => personalGoals.id, { onDelete: "cascade" }),
    cadence: text("cadence").$type<GoalReviewCadence>().notNull(),
    assessment: text("assessment").$type<GoalAssessment>().notNull(),
    evidence: jsonb("evidence").$type<DirectionEvidence[]>().notNull().default(sql`'[]'::jsonb`),
    decisions: jsonb("decisions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    nextActions: jsonb("next_actions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("goal_reviews_cadence_chk", sql`${t.cadence} IN ('weekly','quarterly')`),
    check("goal_reviews_assessment_chk", sql`${t.assessment} IN ('on-track','at-risk','blocked','complete')`),
    index("goal_reviews_goal_reviewed_idx").on(t.goalId, t.reviewedAt),
  ],
);

export const personalOpportunities = pgTable(
  "personal_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    goalId: uuid("goal_id").references(() => personalGoals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    observation: text("observation").notNull(),
    whyNow: text("why_now").notNull(),
    proposedAction: text("proposed_action").notNull(),
    expectedValue: text("expected_value").$type<DirectionLevel>().notNull(),
    risk: text("risk").$type<DirectionLevel>().notNull(),
    actionClass: text("action_class"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    evidence: jsonb("evidence").$type<DirectionEvidence[]>().notNull().default(sql`'[]'::jsonb`),
    contentHash: text("content_hash").notNull(),
    status: text("status").$type<OpportunityStatus>().notNull().default("open"),
    checkpointId: uuid("checkpoint_id"),
    parkedItemId: text("parked_item_id"),
    resolutionReason: text("resolution_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check("personal_opportunities_value_chk", sql`${t.expectedValue} IN ('low','medium','high')`),
    check("personal_opportunities_risk_chk", sql`${t.risk} IN ('low','medium','high')`),
    check("personal_opportunities_status_chk", sql`${t.status} IN ('open','accepted','in_progress','parked','dismissed','completed')`),
    check("personal_opportunities_hash_chk", sql`length(${t.contentHash}) = 64`),
    index("personal_opportunities_project_status_idx").on(t.projectKey, t.status, t.createdAt),
    index("personal_opportunities_goal_idx").on(t.goalId, t.status),
    uniqueIndex("personal_opportunities_checkpoint_uidx").on(t.checkpointId).where(sql`${t.checkpointId} IS NOT NULL`),
    uniqueIndex("personal_opportunities_unresolved_hash_uidx").on(t.projectKey, t.contentHash).where(sql`${t.status} IN ('open','accepted','in_progress','parked')`),
  ],
);

export const workflowCandidates = pgTable(
  "workflow_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectKey: text("project_key").notNull(),
    patternKey: text("pattern_key").notNull(),
    summary: text("summary").notNull(),
    qualifyingCheckpointIds: uuid("qualifying_checkpoint_ids").array().notNull().default(sql`'{}'::uuid[]`),
    successfulRuns: integer("successful_runs").notNull(),
    status: text("status").$type<WorkflowCandidateStatus>().notNull().default("candidate"),
    resolutionReason: text("resolution_reason"),
    materializedCheckpointId: uuid("materialized_checkpoint_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check("workflow_candidates_status_chk", sql`${t.status} IN ('candidate','approved','dismissed','materialized')`),
    check("workflow_candidates_runs_chk", sql`${t.successfulRuns} >= 3`),
    uniqueIndex("workflow_candidates_project_pattern_uidx").on(t.projectKey, t.patternKey),
    index("workflow_candidates_status_idx").on(t.status, t.updatedAt),
  ],
);

export type PersonalGoal = InferSelectModel<typeof personalGoals>;
export type NewPersonalGoal = InferInsertModel<typeof personalGoals>;
export type GoalReview = InferSelectModel<typeof goalReviews>;
export type NewGoalReview = InferInsertModel<typeof goalReviews>;
export type PersonalOpportunity = InferSelectModel<typeof personalOpportunities>;
export type NewPersonalOpportunity = InferInsertModel<typeof personalOpportunities>;
export type WorkflowCandidate = InferSelectModel<typeof workflowCandidates>;
export type NewWorkflowCandidate = InferInsertModel<typeof workflowCandidates>;
