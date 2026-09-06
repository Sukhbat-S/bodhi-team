import type { GoalReview, PersonalGoal } from "../api";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function numericValue(value: string): number | null {
  const normalized = value.toLowerCase();
  if (NUMBER_WORDS[normalized]) return NUMBER_WORDS[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 50 ? parsed : null;
}

function localDay(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface SupervisedReviewProgress {
  completed: number;
  total: number;
}

/**
 * Only derives progress when the goal explicitly defines supervised portfolio
 * reviews on distinct days. Other goals remain qualitative instead of gaining
 * a fabricated percentage from unrelated review records.
 */
export function getSupervisedReviewProgress(goal: PersonalGoal): SupervisedReviewProgress | null {
  const criterion = goal.successCriteria.find((item) =>
    /supervised\s+(?:daily\s+)?portfolio\s+reviews?.*distinct\s+workdays?/i.test(item),
  );
  if (!criterion) return null;
  const match = criterion.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+supervised/i);
  const total = match ? numericValue(match[1]) : null;
  if (!total) return null;

  const reviewDays = new Set(
    goal.reviews
      .filter((review) => review.cadence === "weekly")
      .map((review) => localDay(review.reviewedAt))
      .filter((day): day is string => Boolean(day)),
  );
  return { completed: Math.min(reviewDays.size, total), total };
}

export function latestGoalReview(goal: PersonalGoal): GoalReview | null {
  return goal.reviews.slice().sort((left, right) =>
    new Date(right.reviewedAt).getTime() - new Date(left.reviewedAt).getTime(),
  )[0] ?? null;
}

export function formatGoalDate(value: string | null | undefined, withYear = true): string {
  if (!value) return "No target";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(date);
}

export function goalReviewDayCount(goal: PersonalGoal): number {
  return new Set(
    goal.reviews
      .map((review) => localDay(review.reviewedAt))
      .filter((day): day is string => Boolean(day)),
  ).size;
}

export function orderedGoals(goals: PersonalGoal[]): PersonalGoal[] {
  const statusWeight: Record<PersonalGoal["status"], number> = {
    active: 0,
    paused: 1,
    completed: 2,
    abandoned: 3,
  };
  return goals.slice().sort((left, right) =>
    statusWeight[left.status] - statusWeight[right.status]
      || left.priority - right.priority
      || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}
