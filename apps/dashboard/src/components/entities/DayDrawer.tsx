import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { getMemoriesByDay, type DayMemory } from "../../api";
import { isDayMemoriesResponse, timeInTimeZone } from "../../lib/entityEvidence";
import { ENTITY_TYPE_COLORS } from "../../theme/tokens";

const EASE_PRECISE: [number, number, number, number] = [0.32, 0.72, 0, 1];

function firstLine(content: string): string {
  const line = content.split("\n")[0].trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

interface DayDrawerProps {
  date: string;
  timeZone: string;
  onClose: () => void;
  onHoverEntities: (ids: string[] | null) => void;
  onSelectEntity: (id: string) => void;
}

type DayState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; memories: DayMemory[] };

export function DayDrawer({ date, timeZone, onClose, onHoverEntities, onSelectEntity }: DayDrawerProps) {
  const [state, setState] = useState<DayState>({ status: "loading" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef(0);
  const reduceMotion = useReducedMotion();

  const load = useCallback(() => {
    const requestId = ++requestRef.current;
    setState({ status: "loading" });
    getMemoriesByDay(date)
      .then((response) => {
        if (requestRef.current === requestId) {
          setState(isDayMemoriesResponse(response, date, timeZone)
            ? { status: "ready", memories: response.memories }
            : { status: "unavailable" });
        }
      })
      .catch(() => {
        if (requestRef.current === requestId) setState({ status: "unavailable" });
      });
  }, [date, timeZone]);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => onHoverEntities(null), [onHoverEntities]);

  const header = new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));

  const memories = state.status === "ready" ? state.memories : [];

  return (
    <motion.section
      initial={reduceMotion ? false : { y: 140, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduceMotion ? undefined : { y: 140, opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.28, ease: EASE_PRECISE }}
      className="absolute bottom-0 left-0 right-0 z-20 flex max-h-[70%] flex-col border-t border-stone-800/60 bg-stone-950/95 backdrop-blur-sm sm:max-h-[52%]"
      aria-label={`Memories for ${header}`}
    >
      <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3 sm:px-6">
        <div>
          <p className="font-serif text-[13px] italic text-stone-300">
            {header}{state.status === "ready" ? ` — ${memories.length} memories` : ""}
          </p>
          <p className="mt-1 font-mono text-[10px] text-stone-500">{timeZone}</p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} className="min-h-9 px-2 text-[11px] uppercase tracking-wider text-stone-400 hover:text-stone-100" aria-label="Close day evidence">
          close ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 sm:px-6">
        {state.status === "loading" && <p className="py-4 font-serif text-[12px] italic text-stone-500">Loading day evidence…</p>}
        {state.status === "unavailable" && (
          <div className="py-4">
            <p className="font-serif text-[12px] italic text-stone-300">Day evidence is unavailable.</p>
            <button type="button" onClick={load} className="mt-2 min-h-9 font-mono text-[11px] text-accent-amber hover:text-stone-100">retry</button>
          </div>
        )}
        {state.status === "ready" && memories.length === 0 && <p className="py-4 font-serif text-[12px] italic text-stone-400">No memories were returned for this day.</p>}
        {memories.map((memory) => {
          const ids = memory.entities.map((entity) => entity.id);
          const primary = memory.entities[0];
          return (
            <div key={memory.id} onMouseEnter={() => onHoverEntities(ids.length ? ids : null)} onMouseLeave={() => onHoverEntities(null)} className="flex flex-col gap-2 border-b border-stone-900 py-3 sm:flex-row sm:items-start">
              <span className="w-12 shrink-0 font-mono text-[10px] tabular-nums text-stone-500">{timeInTimeZone(memory.createdAt, timeZone)}</span>
              {primary ? (
                <button
                  type="button"
                  onClick={() => onSelectEntity(primary.id)}
                  onFocus={() => onHoverEntities(ids)}
                  onBlur={() => onHoverEntities(null)}
                  className="min-h-9 min-w-0 flex-1 text-left text-[12px] leading-relaxed text-stone-300 hover:text-stone-100"
                >
                  {firstLine(memory.content)}
                </button>
              ) : (
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-stone-400">{firstLine(memory.content)}</p>
              )}
              {memory.entities.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 sm:max-w-[42%]">
                  {memory.entities.slice(0, 4).map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => onSelectEntity(entity.id)}
                      onFocus={() => onHoverEntities(ids)}
                      onBlur={() => onHoverEntities(null)}
                      className="flex min-h-9 items-center gap-1 rounded-sm border border-stone-700 px-2 text-[10px] text-stone-300 hover:border-stone-500 hover:text-stone-100"
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ENTITY_TYPE_COLORS[entity.type] ?? "#9C9488" }} aria-hidden="true" />
                      {entity.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
