import { useEffect, useMemo, useRef, useState } from "react";
import {
  groupByCluster,
  CLUSTER_LABEL,
  CLUSTER_DESCRIPTION,
  type EntityCluster,
} from "../lib/entityClustering";
import { glyphFor } from "../lib/entityGlyph";
import { EntityHoverPreview } from "./EntityHoverPreview";

interface EntityRow {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  mentionCount: number;
  lastSeenAt?: string | null;
}

function formatRelativeAge(value: string | null | undefined): string {
  if (!value) return "date unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "date unavailable";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const CLUSTER_REGISTER: Record<EntityCluster, { name: string; count: string; padding: string }> = {
  pastWeek: { name: "font-serif text-[17px] text-stone-50", count: "text-[11px] text-stone-400", padding: "py-3.5" },
  pastMonth: { name: "text-[15px] text-stone-100", count: "text-[11px] text-stone-500", padding: "py-3" },
  pastYear: { name: "text-[14px] text-stone-200", count: "text-[11px] text-stone-500", padding: "py-2.5" },
  older: { name: "text-[13px] text-stone-300", count: "text-[11px] text-stone-500", padding: "py-2.5" },
};

export function EntityListFallback({
  nodes,
  selectedId,
  onSelect,
  relatedCounts,
  duplicateIds,
  onDedupClick,
  headerSlot,
}: {
  nodes: EntityRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  relatedCounts?: Map<string, number>;
  duplicateIds?: Set<string>;
  onDedupClick?: () => void;
  headerSlot?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [olderExpanded, setOlderExpanded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);

  function onRowEnter(id: string, event: React.MouseEvent<HTMLButtonElement>) {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPos({ top: rect.top, left: rect.right + 16 });
    setHoveredId(id);
  }

  function onRowLeave() {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredId(null);
      setHoverPos(null);
    }, 150);
  }

  const grouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? nodes.filter((node) => node.name.toLowerCase().includes(normalizedQuery))
      : nodes;
    return groupByCluster(filtered);
  }, [nodes, query]);

  const totalShown = grouped.reduce((sum, group) => sum + group.entities.length, 0);

  return (
    <div className="h-full overflow-y-auto bg-stone-950">
      <div className="mx-auto max-w-2xl px-4 pb-12 pt-8 sm:px-6 md:pt-16">
        <div className="mb-8 flex items-baseline gap-4 md:mb-12">
          <label htmlFor="entity-search" className="sr-only">Search entities</label>
          <input
            id="entity-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search entities"
            className="min-h-10 flex-1 border-0 border-b border-stone-700 bg-transparent pb-2 text-sm text-stone-200 placeholder:text-stone-500 outline-none transition-colors duration-150 ease-precise focus:border-accent-amber"
          />
          {query && <p className="shrink-0 text-[11px] uppercase tracking-wider text-stone-400">{totalShown} match{totalShown === 1 ? "" : "es"}</p>}
        </div>

        {!query && headerSlot && <div className="-mx-4 mb-8 sm:-mx-6">{headerSlot}</div>}

        {grouped.length === 0 ? (
          <p className="mt-10 text-center font-serif text-sm italic text-stone-400">
            {query ? "No entities match this search." : "No entities returned for this view."}
          </p>
        ) : (
          <div className="space-y-10">
            {grouped.map((group) => {
              const isOlder = group.cluster === "older";
              const showRows = !isOlder || olderExpanded;
              const hidden = showRows ? 0 : group.entities.length;
              const register = CLUSTER_REGISTER[group.cluster];
              return (
                <section key={group.cluster}>
                  <div className="mb-3 flex flex-col gap-1 border-b border-stone-800/60 pb-2 sm:flex-row sm:items-baseline sm:justify-between">
                    <div className="flex items-baseline gap-3">
                      <h2 className="text-[11px] uppercase tracking-wider text-stone-300">{CLUSTER_LABEL[group.cluster]}</h2>
                      <span className="text-[11px] tabular-nums text-stone-500">{group.entities.length}</span>
                    </div>
                    <p className="font-serif text-[11px] italic text-stone-500">{CLUSTER_DESCRIPTION[group.cluster]}</p>
                  </div>

                  {showRows && (
                    <ul>
                      {group.entities.map((node) => {
                        const selected = node.id === selectedId;
                        return (
                          <li key={node.id} className="group relative flex items-stretch border-b border-stone-900/70">
                            <button
                              type="button"
                              onClick={() => onSelect(node.id)}
                              onMouseEnter={(event) => onRowEnter(node.id, event)}
                              onMouseLeave={onRowLeave}
                              className={`relative flex min-w-0 flex-1 items-center gap-3 px-3 ${register.padding} text-left transition-colors duration-150 ease-precise ${selected ? "bg-accent-amber/[0.04]" : "hover:bg-stone-900/60"}`}
                            >
                              <span className={`absolute inset-y-0 left-0 w-px ${selected ? "bg-accent-amber/70" : "bg-transparent"}`} aria-hidden="true" />
                              <span className="inline-flex w-3 shrink-0 justify-center text-[12px] text-stone-400" aria-hidden="true">{glyphFor(node.type)}</span>
                              <span className="min-w-0 flex-1">
                                <span className={`${register.name} block truncate`}>
                                  {node.name}
                                  {node.subtype && <span className="font-sans text-[12px] text-stone-500"> · {node.subtype}</span>}
                                </span>
                                <span className="mt-1 block text-[11px] text-stone-500">
                                  last seen {formatRelativeAge(node.lastSeenAt)} · {node.mentionCount} {node.mentionCount === 1 ? "mention" : "mentions"}
                                </span>
                              </span>
                              <span className={`w-10 shrink-0 text-right tabular-nums ${register.count}`}>{node.mentionCount}</span>
                            </button>
                            {duplicateIds?.has(node.id) && (
                              <button
                                type="button"
                                onClick={onDedupClick}
                                className="my-2 mr-2 min-h-9 shrink-0 rounded-sm border border-stone-700 px-2 font-mono text-[10px] text-stone-300 hover:border-accent-amber/60 hover:text-accent-amber"
                                aria-label={`Review possible duplicate for ${node.name}`}
                              >
                                review
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {isOlder && !olderExpanded && (
                    <button type="button" onClick={() => setOlderExpanded(true)} className="mt-2 min-h-10 px-3 text-[11px] uppercase tracking-wider text-stone-400 hover:text-stone-100">
                      show {hidden} older {hidden === 1 ? "entity" : "entities"} →
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {hoveredId && hoverPos && (
        <div className="pointer-events-none fixed z-50 hidden md:block" style={{ top: hoverPos.top, left: hoverPos.left }}>
          <EntityHoverPreview entityId={hoveredId} relatedCount={relatedCounts?.get(hoveredId) ?? 0} />
        </div>
      )}
    </div>
  );
}
