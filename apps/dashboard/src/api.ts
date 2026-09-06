// BODHI Entities console — the smallest browser API needed for spatial curation.

const BASE = "/api";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : response.statusText;
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json();
}

export interface MemoryHistogramDay {
  day: string;
  count: number;
}

export interface MemoryHistogramResponse {
  days: MemoryHistogramDay[];
  /** Configured owner IANA timezone used to produce every returned day key. */
  timeZone?: string;
}

export function getMemoryHistogram(days = 90) {
  return request<MemoryHistogramResponse>(`/memories/histogram?days=${days}`);
}

export interface DayMemoryEntity {
  id: string;
  name: string;
  type: string;
}

export interface DayMemory {
  id: string;
  content: string;
  type: string;
  importance: number;
  createdAt: string;
  entities: DayMemoryEntity[];
}

export interface DayMemoriesResponse {
  date?: string;
  memories: DayMemory[];
  /** Configured owner IANA timezone used for the requested date boundary. */
  timeZone?: string;
}

export function getMemoriesByDay(date: string) {
  return request<DayMemoriesResponse>(`/memories/by-day?date=${date}`);
}

export type GoalStatus = "active" | "paused" | "completed" | "abandoned";
export type GoalAssessment = "on-track" | "at-risk" | "blocked" | "complete";
export type GoalReviewCadence = "weekly" | "quarterly";

export interface GoalEvidence {
  sourceKind: "file" | "goal" | "checkpoint" | "memory" | "parking" | "verification" | "activity" | "other";
  reference: string;
  observedAt: string;
  sha256: string;
  summary: string;
}

export interface GoalReview {
  id: string;
  cadence: GoalReviewCadence;
  assessment: GoalAssessment;
  evidence: GoalEvidence[];
  decisions: string[];
  nextActions: string[];
  reviewedAt: string;
  createdAt: string;
}

export interface PersonalGoal {
  id: string;
  projectKey: string;
  title: string;
  outcome: string;
  successCriteria: string[];
  constraints: string[];
  priority: number;
  status: GoalStatus;
  targetDate: string | null;
  observationScopes: Array<{ kind: "project" | "path"; ref: string; purpose: string }>;
  lastWeeklyReviewAt: string | null;
  lastQuarterlyReviewAt: string | null;
  nextWeeklyReviewAt: string;
  nextQuarterlyReviewAt: string;
  weeklyReviewDue: boolean;
  quarterlyReviewDue: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  reviews: GoalReview[];
}

export function getGoals(project = "bodhi", limit = 20) {
  const params = new URLSearchParams({ project, limit: String(limit) });
  return request<{ goals: PersonalGoal[] }>(`/goals?${params}`);
}
