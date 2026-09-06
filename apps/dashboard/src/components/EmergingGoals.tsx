import { useEffect, useState } from "react";

interface GoalMemory {
  id: string;
  content: string;
  createdAt: string;
  entities: Array<{ id: string; name: string }>;
}

interface EmergingGoalsProps {
  onSelectEntity: (entityId: string) => void;
  days?: number;
  limit?: number;
}

type GoalMemoryState = "loading" | "ready" | "unavailable";

function validGoalMemory(value: unknown): value is GoalMemory {
  if (typeof value !== "object" || value === null) return false;
  const goal = value as Record<string, unknown>;
  return typeof goal.id === "string" && typeof goal.content === "string" && typeof goal.createdAt === "string" &&
    Array.isArray(goal.entities) && goal.entities.every((entity) => {
      if (typeof entity !== "object" || entity === null) return false;
      const item = entity as Record<string, unknown>;
      return typeof item.id === "string" && typeof item.name === "string";
    });
}

export function EmergingGoals({ onSelectEntity, days = 30, limit = 4 }: EmergingGoalsProps) {
  const [goals, setGoals] = useState<GoalMemory[]>([]);
  const [state, setState] = useState<GoalMemoryState>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/memories/emerging-goals?days=${days}&limit=${limit}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data: unknown = await response.json();
        if (typeof data !== "object" || data === null || !Array.isArray((data as { goals?: unknown }).goals)) throw new Error("invalid goal memory response");
        const next = (data as { goals: unknown[] }).goals;
        if (!next.every(validGoalMemory)) throw new Error("invalid goal memory");
        if (!cancelled) {
          setGoals(next);
          setState("ready");
        }
      })
      .catch(() => { if (!cancelled) setState("unavailable"); });
    return () => { cancelled = true; };
  }, [days, limit]);

  if (state === "loading" || (state === "ready" && goals.length === 0)) return null;

  if (state === "unavailable") {
    return <p role="status" className="flex-shrink-0 border-b border-stone-800/60 px-4 py-2 font-serif text-[11px] italic text-stone-400 sm:px-6">Recent goal memories are unavailable.</p>;
  }

  return (
    <section className="flex flex-shrink-0 items-center gap-5 overflow-x-auto border-b border-stone-800/60 px-4 py-2 sm:px-6" aria-label={`Goal memories from the past ${days} days`}>
      <span className="flex-shrink-0 font-mono text-[10px] tracking-[0.14em] text-stone-400">GOAL MEMORIES · {days}D</span>
      {goals.map((goal) => (
        <div key={goal.id} className="flex items-center gap-2 whitespace-nowrap">
          <span className="max-w-72 truncate font-serif text-[13px] italic text-stone-300" title={goal.content}>{goal.content}</span>
          {goal.entities.slice(0, 2).map((entity) => (
            <button key={entity.id} type="button" onClick={() => onSelectEntity(entity.id)} className="min-h-9 px-1 font-mono text-[11px] text-stone-400 hover:text-stone-100">{entity.name}</button>
          ))}
        </div>
      ))}
    </section>
  );
}
