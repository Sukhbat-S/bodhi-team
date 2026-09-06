import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getGoals, type GoalAssessment, type GoalStatus, type PersonalGoal } from "../api";
import {
  formatGoalDate,
  getSupervisedReviewProgress,
  goalReviewDayCount,
  latestGoalReview,
  orderedGoals,
} from "../lib/goals";

type GoalFilter = "all" | GoalStatus;

const GOAL_FILTERS: GoalFilter[] = ["all", "active", "paused", "completed", "abandoned"];

function isGoalFilter(value: string | null): value is GoalFilter {
  return value !== null && GOAL_FILTERS.includes(value as GoalFilter);
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  abandoned: "Abandoned",
};

const ASSESSMENT_STYLES: Record<GoalAssessment, string> = {
  "on-track": "border-sage/40 bg-sage/10 text-sage",
  "at-risk": "border-accent-amber/40 bg-accent-amber-soft text-accent-amber",
  blocked: "border-clay/40 bg-clay/10 text-clay",
  complete: "border-sage/40 bg-sage/10 text-sage",
};

function statusDot(status: GoalStatus): string {
  if (status === "active") return "bg-sage";
  if (status === "paused") return "bg-accent-amber";
  if (status === "completed") return "bg-stone-500";
  return "bg-stone-700";
}

function assessmentLabel(value: GoalAssessment): string {
  if (value === "on-track") return "On track";
  if (value === "at-risk") return "At risk";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TargetSummary({ goal }: { goal: PersonalGoal }) {
  const progress = getSupervisedReviewProgress(goal);
  const review = latestGoalReview(goal);
  const nextAction = review?.nextActions[0] ?? "No next action has been recorded yet.";

  return (
    <section aria-labelledby="goal-progress-heading" className="grid overflow-hidden border border-stone-800/80 bg-stone-900/25 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
      <div className="px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p id="goal-progress-heading" className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-600">Progress</p>
            {progress ? (
              <p className="mt-3 font-serif text-[34px] leading-none tracking-[-0.035em] text-stone-100 sm:text-[42px]">
                {progress.completed}<span className="text-stone-700">/{progress.total}</span>
                <span className="ml-3 text-[16px] italic tracking-normal text-stone-500">supervised days</span>
              </p>
            ) : (
              <p className="mt-3 font-serif text-[30px] leading-none tracking-[-0.025em] text-stone-100">
                {goalReviewDayCount(goal)} <span className="text-[16px] italic tracking-normal text-stone-500">review days</span>
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-stone-700">Target</p>
            <p className="mt-1 font-mono text-[11px] tabular-nums text-stone-300">{formatGoalDate(goal.targetDate)}</p>
          </div>
        </div>

        {progress && (
          <div className="mt-6 grid grid-cols-5 gap-2" role="img" aria-label={`${progress.completed} of ${progress.total} supervised days recorded`}>
            {Array.from({ length: progress.total }, (_, index) => (
              <span
                key={index}
                className={`h-1.5 ${index < progress.completed ? "bg-accent-amber" : "bg-stone-800"}`}
                aria-hidden="true"
              />
            ))}
          </div>
        )}
        <p className="mt-4 text-[11px] leading-5 text-stone-600">
          {progress ? "Each segment represents one distinct day with a stored supervised review." : "Progress remains qualitative unless the goal defines a measurable review cadence."}
        </p>
      </div>

      <div className="border-t border-stone-800/80 px-5 py-6 sm:px-7 lg:border-l lg:border-t-0">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-accent-amber/80">Next recorded action</p>
        <p className="mt-3 font-serif text-[17px] leading-[1.45] text-stone-300">{nextAction}</p>
        <p className="mt-4 font-mono text-[8px] uppercase tracking-[0.13em] text-stone-700">
          From {review ? formatGoalDate(review.reviewedAt, false) : "the latest review"}
        </p>
      </div>
    </section>
  );
}

function CriteriaSection({ goal }: { goal: PersonalGoal }) {
  return (
    <div className="grid gap-8 xl:grid-cols-2 xl:gap-12">
      <section aria-labelledby="success-criteria-heading">
        <div className="flex items-baseline justify-between border-b border-stone-800/70 pb-3">
          <h2 id="success-criteria-heading" className="font-serif text-[19px] text-stone-200">Success means</h2>
          <span className="font-mono text-[8px] tabular-nums tracking-[0.14em] text-stone-700">{goal.successCriteria.length} CRITERIA</span>
        </div>
        <ol className="divide-y divide-stone-800/50">
          {goal.successCriteria.map((criterion, index) => (
            <li key={`${index}-${criterion}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 py-4">
              <span className="font-mono text-[9px] tabular-nums text-accent-amber/70">{String(index + 1).padStart(2, "0")}</span>
              <p className="text-[12px] leading-[1.65] text-stone-400">{criterion}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="constraints-heading">
        <div className="flex items-baseline justify-between border-b border-stone-800/70 pb-3">
          <h2 id="constraints-heading" className="font-serif text-[19px] text-stone-200">Guardrails</h2>
          <span className="font-mono text-[8px] tabular-nums tracking-[0.14em] text-stone-700">{goal.constraints.length} GUARDRAILS</span>
        </div>
        <ul className="divide-y divide-stone-800/50">
          {goal.constraints.map((constraint, index) => (
            <li key={`${index}-${constraint}`} className="grid grid-cols-[8px_minmax(0,1fr)] gap-4 py-4">
              <span className="mt-[7px] h-1 w-1 rounded-full bg-stone-600" aria-hidden="true" />
              <p className="text-[12px] leading-[1.65] text-stone-400">{constraint}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReviewsSection({ goal }: { goal: PersonalGoal }) {
  const reviews = useMemo(() => goal.reviews.slice().sort((left, right) =>
    new Date(right.reviewedAt).getTime() - new Date(left.reviewedAt).getTime(),
  ), [goal.reviews]);

  return (
    <section aria-labelledby="reviews-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-800/70 pb-3">
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-stone-700">Decision trail</p>
          <h2 id="reviews-heading" className="mt-2 font-serif text-[22px] text-stone-200">Recent review history</h2>
        </div>
        <span className="font-mono text-[8px] tabular-nums tracking-[0.14em] text-stone-700">LATEST {reviews.length} RECORDS · {goalReviewDayCount(goal)} DAYS</span>
      </div>

      {reviews.length === 0 ? (
        <p className="py-10 font-serif text-[15px] italic text-stone-600">No reviewed decision has been stored for this goal yet.</p>
      ) : (
        <div className="divide-y divide-stone-800/60">
          {reviews.map((review, index) => (
            <details key={review.id} className="group py-5" open={index === 0}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] ${ASSESSMENT_STYLES[review.assessment]}`}>
                    {assessmentLabel(review.assessment)}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-serif text-[16px] text-stone-300">{formatGoalDate(review.reviewedAt)}</span>
                    <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.12em] text-stone-700">{review.cadence} review · {review.evidence.length} evidence items</span>
                  </span>
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-stone-600 group-open:text-accent-amber">Details</span>
              </summary>

              <div className="mt-5 grid gap-7 border-l border-stone-800/80 pl-5 lg:grid-cols-2 lg:gap-10 lg:pl-7">
                <div>
                  <h3 className="font-mono text-[8px] uppercase tracking-[0.16em] text-stone-600">Decisions</h3>
                  {review.decisions.length ? (
                    <ul className="mt-3 space-y-3">
                      {review.decisions.map((decision) => (
                        <li key={decision} className="text-[11px] leading-[1.7] text-stone-400">{decision}</li>
                      ))}
                    </ul>
                  ) : <p className="mt-3 text-[11px] italic text-stone-700">No decision text recorded.</p>}

                  <h3 className="mt-6 font-mono text-[8px] uppercase tracking-[0.16em] text-stone-600">Next actions</h3>
                  {review.nextActions.length ? (
                    <ol className="mt-3 space-y-3">
                      {review.nextActions.map((action, actionIndex) => (
                        <li key={action} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-[11px] leading-[1.7] text-stone-400">
                          <span className="font-mono text-[8px] text-accent-amber/60">{String(actionIndex + 1).padStart(2, "0")}</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="mt-3 text-[11px] italic text-stone-700">No next action recorded.</p>}
                </div>

                <div>
                  <h3 className="font-mono text-[8px] uppercase tracking-[0.16em] text-stone-600">Evidence</h3>
                  {review.evidence.length ? (
                    <ul className="mt-3 space-y-4">
                      {review.evidence.map((evidence) => (
                        <li key={`${evidence.sha256}-${evidence.reference}`}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-accent-amber/60">{evidence.sourceKind}</span>
                            <span className="font-mono text-[8px] tabular-nums text-stone-700">{formatGoalDate(evidence.observedAt, false)}</span>
                          </div>
                          <p className="mt-1.5 text-[11px] leading-[1.65] text-stone-500">{evidence.summary}</p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-3 text-[11px] italic text-stone-700">No evidence summary recorded.</p>}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export default function GoalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [goals, setGoals] = useState<PersonalGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await getGoals("bodhi", 20);
      setGoals(orderedGoals(response.goals ?? []));
      setLoadedAt(new Date());
    } catch {
      setError("Goals could not be loaded. Check that BODHI is running, then retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedFromUrl = searchParams.get("goal");
  const requestedGoal = goals.find((goal) => goal.id === selectedFromUrl);
  const requestedFilter = searchParams.get("status");
  const filter: GoalFilter = isGoalFilter(requestedFilter)
    ? requestedFilter
    : requestedGoal?.status ?? "active";
  const filteredGoals = filter === "all" ? goals : goals.filter((goal) => goal.status === filter);
  const selectedGoal = filteredGoals.find((goal) => goal.id === selectedFromUrl)
    ?? filteredGoals[0]
    ?? null;

  useEffect(() => {
    if (!selectedGoal || selectedFromUrl === selectedGoal.id) return;
    setSearchParams({
      goal: selectedGoal.id,
      ...(filter === "active" ? {} : { status: filter }),
    }, { replace: true });
  }, [filter, selectedFromUrl, selectedGoal, setSearchParams]);

  const chooseFilter = (value: GoalFilter) => {
    const currentGoal = goals.find((goal) => goal.id === selectedFromUrl);
    const candidates = value === "all" ? goals : goals.filter((goal) => goal.status === value);
    const nextGoal = currentGoal && candidates.some((goal) => goal.id === currentGoal.id)
      ? currentGoal
      : candidates[0];
    setSearchParams({
      ...(nextGoal ? { goal: nextGoal.id } : {}),
      ...(value === "active" ? {} : { status: value }),
    });
  };

  const activeCount = goals.filter((goal) => goal.status === "active").length;
  const latestReview = selectedGoal ? latestGoalReview(selectedGoal) : null;

  return (
    <div className="h-full overflow-y-auto bg-stone-950 text-stone-200">
      <div className="mx-auto grid min-h-full max-w-[1520px] grid-cols-1 lg:grid-cols-[318px_minmax(0,1fr)]">
        <aside className="border-b border-stone-800/50 px-5 py-7 sm:px-7 lg:border-b-0 lg:border-r lg:px-8 lg:py-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-accent-amber/80">Structured direction</p>
              <h1 className="mt-3 font-serif text-[34px] tracking-[-0.035em] text-stone-100">Goals</h1>
              <p className="mt-2 text-[11px] leading-5 text-stone-600">Durable outcomes, reviewed decisions, and the evidence behind them.</p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="mt-1 border border-stone-800 px-2.5 py-2 font-mono text-[8px] uppercase tracking-[0.13em] text-stone-500 transition-colors hover:border-stone-700 hover:text-stone-300 disabled:cursor-wait disabled:opacity-50"
            >
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>

          <div className="mt-7 flex items-baseline gap-2 border-t border-stone-800/70 pt-5">
            <span className="font-serif text-[28px] leading-none text-stone-200">{activeCount}</span>
            <span className="font-serif text-[14px] italic text-stone-600">active {activeCount === 1 ? "goal" : "goals"}</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2" aria-label="Filter goals">
            {(["active", "all", "paused", "completed"] as GoalFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => chooseFilter(value)}
                className={`font-mono text-[8px] uppercase tracking-[0.13em] transition-colors ${filter === value ? "text-accent-amber" : "text-stone-700 hover:text-stone-400"}`}
              >
                {value}
              </button>
            ))}
          </div>

          <nav aria-label="Structured goals" className="mt-6 space-y-2">
            {filteredGoals.map((goal) => {
              const selected = selectedGoal?.id === goal.id;
              const progress = getSupervisedReviewProgress(goal);
              return (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => setSearchParams({
                    goal: goal.id,
                    ...(filter === "active" ? {} : { status: filter }),
                  })}
                  aria-current={selected ? "page" : undefined}
                  className={`w-full border px-4 py-4 text-left transition-colors ${selected ? "border-stone-700 bg-stone-900/70" : "border-transparent hover:border-stone-800/80 hover:bg-stone-900/30"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.13em] text-stone-600">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDot(goal.status)}`} aria-hidden="true" />
                      {STATUS_LABELS[goal.status]}
                    </span>
                    <span className="font-mono text-[8px] tabular-nums text-stone-700">P{goal.priority}</span>
                  </div>
                  <p className={`mt-2 font-serif text-[15px] leading-[1.35] ${selected ? "text-stone-200" : "text-stone-500"}`}>{goal.title}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[0.11em] text-stone-700">
                    <span>{progress ? `${progress.completed}/${progress.total} days` : `${goal.reviews.length} reviews`}</span>
                    <span>{formatGoalDate(goal.targetDate, false)}</span>
                  </div>
                </button>
              );
            })}
          </nav>

          {!loading && filteredGoals.length === 0 && (
            <p className="mt-8 font-serif text-[14px] italic text-stone-700">No {filter} goals.</p>
          )}

          <div className="mt-8 border-t border-stone-800/70 pt-5">
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-stone-700">Read-only control surface</p>
            <p className="mt-2 text-[10px] leading-5 text-stone-700">Goal changes remain explicit, human-reviewed Codex decisions. This page never executes work.</p>
          </div>
        </aside>

        <section className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-10 xl:px-14">
          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <p className="font-serif text-[15px] italic text-stone-600">Opening structured direction…</p>
            </div>
          ) : error ? (
            <div className="max-w-2xl border-l border-clay/60 pl-5 py-1">
              <h2 className="font-serif text-[24px] text-stone-200">Goals are unavailable</h2>
              <p className="mt-3 text-[12px] leading-6 text-stone-500">{error}</p>
              <button type="button" onClick={() => void load()} className="mt-5 font-mono text-[9px] uppercase tracking-[0.15em] text-accent-amber">Retry</button>
            </div>
          ) : !selectedGoal ? (
            <div className="max-w-2xl">
              <h2 className="font-serif text-[26px] text-stone-200">
                {goals.length === 0 ? "No structured goals yet" : `No ${filter} goals`}
              </h2>
              <p className="mt-3 text-[12px] leading-6 text-stone-500">
                {goals.length === 0
                  ? "Goals appear here after you explicitly create one with Codex."
                  : "Choose another filter to keep reviewing durable direction."}
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-[1080px] animate-morning-arrival">
              <header>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-sage">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot(selectedGoal.status)}`} aria-hidden="true" />
                    {STATUS_LABELS[selectedGoal.status]}
                  </span>
                  <span className="text-stone-800">/</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone-600">{selectedGoal.projectKey}</span>
                  <span className="text-stone-800">/</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone-600">Priority {selectedGoal.priority}</span>
                  {latestReview && (
                    <span className={`ml-auto border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] ${ASSESSMENT_STYLES[latestReview.assessment]}`}>
                      {assessmentLabel(latestReview.assessment)}
                    </span>
                  )}
                </div>
                <h1 className="mt-5 max-w-4xl font-serif text-[32px] leading-[1.08] tracking-[-0.03em] text-stone-100 sm:text-[43px] lg:text-[48px]">
                  {selectedGoal.title}
                </h1>
                <p className="mt-5 max-w-3xl font-serif text-[17px] leading-[1.55] text-stone-400 sm:text-[19px]">{selectedGoal.outcome}</p>
                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[8px] uppercase tracking-[0.13em] text-stone-700">
                  <span>Updated {formatGoalDate(selectedGoal.updatedAt)}</span>
                  <span>Weekly review {selectedGoal.weeklyReviewDue ? "due" : `next ${formatGoalDate(selectedGoal.nextWeeklyReviewAt, false)}`}</span>
                  <span>Quarterly review {selectedGoal.quarterlyReviewDue ? "due" : `next ${formatGoalDate(selectedGoal.nextQuarterlyReviewAt, false)}`}</span>
                  {loadedAt && <span aria-live="polite">Synced {loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
              </header>

              <div className="mt-9">
                <TargetSummary goal={selectedGoal} />
              </div>
              <div className="mt-11">
                <CriteriaSection goal={selectedGoal} />
              </div>
              {selectedGoal.observationScopes.length > 0 && (
                <section aria-labelledby="observation-scopes-heading" className="mt-11 border-t border-stone-800/70 pt-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 id="observation-scopes-heading" className="font-serif text-[19px] text-stone-200">Observation scope</h2>
                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-stone-700">Explicitly bounded</span>
                  </div>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {selectedGoal.observationScopes.map((scope, index) => (
                      <li key={`${index}-${scope.kind}-${scope.ref}`} className="border border-stone-800/70 px-4 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-accent-amber/70">{scope.kind}</span>
                          <span className="max-w-full break-all font-mono text-[8px] text-stone-700">{scope.ref}</span>
                        </div>
                        <p className="mt-2 text-[11px] leading-[1.65] text-stone-500">{scope.purpose}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="mt-12 pb-12">
                <ReviewsSection goal={selectedGoal} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
