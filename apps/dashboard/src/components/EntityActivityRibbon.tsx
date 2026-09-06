// ============================================================
// EntityActivityRibbon — DESIGN.md §12.3 + §12.7
// ============================================================
//
// Phase C-7a (May 9 late evening). Thin horizontal band above the
// /entities main view showing the last ~10 memory events, each with
// its primary linked entity chip. Click a row → opens that entity's
// EntityThread.
//
// This is the "Are.na Explore" pattern — time as a band, not a page.
// Replaces what /timeline would have been if /timeline survived.
// /timeline is being deleted in Phase C-7c.
//
// Reading-mode-compatible (§12.1, §12.7) — no filters, no chrome.
// Hierarchy by recency, not by type (§12.2). Single muted dot; type
// distinction lives in the optional subtype suffix on the name, not
// in color (§1.4 single accent, §9 no bright defaults, §12.9 no
// type-colored badges).

import { useEffect, useState } from "react";
import { glyphFor } from "../lib/entityGlyph";

interface RecentMemory {
  id: string;
  content: string;
  type: string;
  importance: number;
  createdAt: string;
  entity: {
    id: string;
    name: string;
    type: string;
    subtype: string | null;
  } | null;
}

function validRecentMemory(value: unknown): value is RecentMemory {
  if (typeof value !== "object" || value === null) return false;
  const memory = value as Record<string, unknown>;
  if (typeof memory.id !== "string" || typeof memory.content !== "string" || typeof memory.createdAt !== "string") return false;
  if (memory.entity === null) return true;
  if (typeof memory.entity !== "object") return false;
  const entity = memory.entity as Record<string, unknown>;
  return typeof entity.id === "string" && typeof entity.name === "string" && typeof entity.type === "string" &&
    (typeof entity.subtype === "string" || entity.subtype === null);
}

function formatAge(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface EntityActivityRibbonProps {
  onSelectEntity: (entityId: string) => void;
  limit?: number;
}

export function EntityActivityRibbon({ onSelectEntity, limit = 10 }: EntityActivityRibbonProps) {
  const [memories, setMemories] = useState<RecentMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/memories/recent-with-entities?limit=${limit}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { memories?: RecentMemory[] }) => {
        if (!Array.isArray(data.memories) || !data.memories.every(validRecentMemory)) throw new Error("invalid recent memories response");
        if (!cancelled) {
          setMemories(data.memories);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [limit]);

  if (loading) return null;
  if (unavailable) return <p role="status" className="px-6 py-3 font-serif text-[11px] italic text-stone-400">Recent entity evidence is unavailable.</p>;
  if (memories.length === 0) return null;

  return (
    <section className="border-b border-stone-800/40 px-6 py-5">
      <p className="mb-3 text-[10px] uppercase tracking-wider text-stone-500">
        recent
      </p>
      <ul className="space-y-2">
        {memories.map((m) => {
          const snippet = m.content.length > 80 ? `${m.content.slice(0, 80)}…` : m.content;
          const nameLabel = m.entity?.subtype
            ? `${m.entity.name} · ${m.entity.subtype}`
            : m.entity?.name ?? "—";
          return (
            <li key={m.id}>
              <button
                type="button"
                disabled={!m.entity}
                onClick={() => m.entity && onSelectEntity(m.entity.id)}
                className={`group flex min-h-10 w-full items-baseline gap-3 text-left transition-colors duration-150 ease-precise ${
                  m.entity ? "hover:text-stone-100 cursor-pointer" : "cursor-default"
                }`}
              >
                <span
                  className="shrink-0 inline-flex w-3 justify-center self-center text-[11px] leading-none text-stone-500"
                  aria-hidden="true"
                >
                  {glyphFor(m.entity?.type)}
                </span>
                <span className="shrink-0 w-40 truncate text-[12px] text-stone-300">
                  {nameLabel}
                </span>
                <span className="flex-1 truncate text-[12px] text-stone-500 group-hover:text-stone-400 transition-colors duration-150 ease-precise">
                  "{snippet}"
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-stone-600">
                  {formatAge(m.createdAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
