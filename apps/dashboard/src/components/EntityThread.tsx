// ============================================================
// EntityThread — in-place evidence panel governed by DESIGN.md
// ============================================================
//
// The in-place detail panel that opens when a node is selected:
// kind-dot + mono kicker + serif name header, a 2×2 mono stat
// grid, the THREAD (date gutter + clamped serif prose), and a
// quiet RELATED dot-list that swaps the thread on click.
//
// Replaces the v2 backdrop-drawer: the prototype keeps the whole
// constellation visible, so there is NO scrim — the panel slides
// in absolutely over the canvas (no reflow, no re-layout) via
// framer-motion ease-precise, same grammar as DayDrawer.
//
// Honesty rules: real memory text clamped to 3 lines (the
// prototype's one-liners are synthesized mock — we clamp real
// prose, never rewrite it); "—" for nulls, never a fabricated
// value. Placeholder-then-populate flow preserved: the panel
// opens instantly from in-memory row data, thread + related fill
// in when /api/entities/:id resolves.

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { entityColor } from "../theme/tokens";
import { relTime } from "../lib/format";

/** ease-precise (tailwind §5) as a framer-motion bezier — same as DayDrawer. */
const EASE_PRECISE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Thread rows are capped — a hub entity's full history belongs to search. */
const MAX_THREAD_ROWS = 12;

interface MemoryEntry {
  id: string;
  content: string;
  type: string;
  importance: number;
  createdAt: string;
}

interface RelatedEntity {
  id: string;
  name: string;
  type: string;
  sharedMemoryCount: number;
}

export interface EntityThreadData {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  mentionCount: number;
  description: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  memories: MemoryEntry[];
  relatedEntities: RelatedEntity[];
}

function parsedTimestamp(value: string): Date | null {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Mon YYYY" in the configured owner timezone; "—" when unavailable. */
export function monthYearInTimeZone(value: string | null | undefined, timeZone: string | null): string {
  if (!value || !timeZone) return "—";
  const date = parsedTimestamp(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { timeZone, month: "short", year: "numeric" });
}

/** "Jun 11"-style date gutter in the configured owner timezone. */
export function gutterDateInTimeZone(value: string, timeZone: string | null): string {
  if (!timeZone) return "—";
  const date = parsedTimestamp(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });
}

interface EntityThreadProps {
  entity: EntityThreadData | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
  timeZone: string | null;
  loading?: boolean;
  unavailable?: boolean;
}

export function EntityThread({ entity, onClose, onNavigate, timeZone, loading = false, unavailable = false }: EntityThreadProps) {
  const reduceMotion = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  // Esc to dismiss — the page's capture-phase handler closes the visible
  // detail before any day drawer beneath it; this is the standalone fallback.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [entity?.id]);

  if (!entity) return null;

  const thread = [...entity.memories]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_THREAD_ROWS);

  const dot = entityColor(entity.type);
  const pendingRelated = loading && entity.relatedEntities.length === 0;

  return (
    <motion.aside
      initial={reduceMotion ? false : { x: "104%" }}
      animate={{ x: 0 }}
      exit={reduceMotion ? undefined : { x: "104%" }}
      transition={{ duration: reduceMotion ? 0 : 0.32, ease: EASE_PRECISE }}
      className="absolute inset-0 z-40 overflow-y-auto border-l border-stone-800/60 bg-[#121215] px-5 py-5 shadow-[-40px_0_80px_rgba(0,0,0,0.35)] sm:bottom-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[372px] sm:px-[30px] sm:py-[26px]"
      aria-label={`Entity details for ${entity.name}`}
    >
      {/* ── Header — kind dot + mono kicker, serif name, close × ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: dot }}
              aria-hidden="true"
            />
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[#5F5F66]">
              {entity.type} · {entity.subtype || "—"}
            </p>
          </div>
          <h2 className="font-serif text-2xl text-stone-100">{entity.name}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="shrink-0 px-1 text-[16px] leading-none text-stone-600 transition-colors duration-150 ease-precise hover:text-stone-200"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* ── Stat grid 2×2 — mono values, caption labels (prototype grammar) ── */}
      <div className="my-6 grid grid-cols-2 gap-x-5 gap-y-3.5 border-y border-stone-100/[0.07] py-[18px]">
        <div>
          <div className="font-mono text-[13px] text-[#C7C7CB]">{monthYearInTimeZone(entity.firstSeenAt, timeZone)}</div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.1em] text-stone-500">FIRST SEEN</div>
        </div>
        <div>
          <div className="font-mono text-[13px] tabular-nums text-[#C7C7CB]">{entity.mentionCount}</div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.1em] text-stone-500">MENTIONS</div>
        </div>
        <div>
          <div className="font-mono text-[13px] tabular-nums text-[#C7C7CB]">
            {pendingRelated || unavailable ? "—" : entity.relatedEntities.length}
          </div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.1em] text-stone-500">RELATED SHOWN · MAX 20</div>
        </div>
        <div>
          <div className="font-mono text-[13px] text-[#C7C7CB]">{relTime(entity.lastSeenAt ?? null)}</div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.1em] text-stone-500">LAST SEEN</div>
        </div>
      </div>

      {unavailable && (
        <p role="status" className="mb-5 rounded-sm border border-stone-700 bg-stone-900/50 px-3 py-2 font-serif text-[12px] italic text-stone-300">
          Evidence details are unavailable. Showing the last loaded entity summary.
        </p>
      )}

      {/* ── THREAD — date gutter + serif prose clamped to 3 lines ── */}
      <p className="mb-1 font-mono text-[10px] tracking-[0.2em] text-[#5F5F66]">THREAD</p>
      {thread.length > 0 ? (
        thread.map((m) => (
          <div key={m.id} className="flex gap-3.5 border-b border-stone-100/[0.05] py-[11px]">
            <span className="w-[42px] shrink-0 pt-[3px] font-mono text-[10px] text-[#46464C]">
              {gutterDateInTimeZone(m.createdAt, timeZone)}
            </span>
            <p className="line-clamp-3 min-w-0 font-serif text-[13.5px] leading-[1.6] text-[#C7C7CB]">
              {m.content}
            </p>
          </div>
        ))
      ) : loading ? (
        [0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3.5 border-b border-stone-100/[0.05] py-[11px]">
            <div className="h-2.5 w-[42px] shrink-0 animate-pulse rounded bg-stone-900/70" />
            <div className="min-w-0 flex-1">
              <div className="h-3 w-5/6 animate-pulse rounded bg-stone-900" />
              <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-stone-900" />
            </div>
          </div>
        ))
      ) : unavailable ? null : (
        <p className="py-3 font-serif text-[13px] italic text-stone-500">No memories linked yet.</p>
      )}

      {/* ── RELATED — quiet dot-list; click swaps the thread ── */}
      <p className="mb-1 mt-[22px] font-mono text-[10px] tracking-[0.2em] text-[#5F5F66]">RELATED</p>
      {entity.relatedEntities.length > 0 ? (
        entity.relatedEntities.map((re) => (
          <button
            key={re.id}
            type="button"
            onClick={() => onNavigate(re.id)}
            title={`${re.sharedMemoryCount} shared ${re.sharedMemoryCount === 1 ? "memory" : "memories"}`}
            className="-mx-1.5 flex w-[calc(100%+12px)] items-center gap-2.5 rounded-[3px] px-1.5 py-2 text-left transition-colors duration-200 ease-precise hover:bg-stone-100/[0.035]"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: entityColor(re.type) }}
              aria-hidden="true"
            />
            <span className="truncate text-[13px] text-[#9A9A9F]">{re.name}</span>
          </button>
        ))
      ) : pendingRelated ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5 py-2">
            <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-stone-900" />
            <div className="h-3 w-28 animate-pulse rounded bg-stone-900" />
          </div>
        ))
      ) : unavailable ? null : (
        <p className="py-2 font-serif text-[13px] italic text-stone-500">No related entities.</p>
      )}
    </motion.aside>
  );
}
