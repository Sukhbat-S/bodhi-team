import { useId, useState, type ReactNode } from "react";
import { ENTITY_TYPE_COLORS, PRODUCT_TOKEN_FALLBACK } from "../../theme/tokens";

export interface MergeClusterEntity {
  id: string;
  name: string;
  type: string;
  mentionCount: number;
  lastSeenAt: string | null;
}

export interface MergeCluster {
  key: string;
  kind: "exact_normalized" | "domain_suffix";
  totalMentions: number;
  entities: MergeClusterEntity[];
}

export type MergeCandidateState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; clusters: MergeCluster[] };

const KIND_LABEL: Record<MergeCluster["kind"], string> = {
  exact_normalized: "same normalized name",
  domain_suffix: "same name, different domain suffix",
};

const SUBTYPES_BY_TYPE: Record<string, string[]> = {
  person: ["sister", "family", "client", "friend", "mentor", "advisor", "stranger"],
  project: ["brand", "codebase", "creative", "research", "side-bet"],
  organization: ["supplier", "platform", "media", "school", "venue", "financial", "government"],
  topic: ["concept", "skill", "domain"],
  place: ["city", "site", "country"],
};

const SECTION_LABEL = "font-mono text-[11px] tracking-[0.16em] text-stone-400";

interface EntitiesRailProps {
  entityTypes: [string, number][];
  typeFilter: string | null;
  setTypeFilter: (t: string | null) => void;
  subtypeFilter: string | null;
  setSubtypeFilter: (s: string | null) => void;
  minMentions: number;
  setMinMentions: (n: number) => void;
  candidates: MergeCandidateState;
  onRetryCandidates: () => void;
  footer?: ReactNode;
  className?: string;
}

function candidateRequest(cluster: MergeCluster): string {
  const [keeper, ...others] = cluster.entities;
  if (!keeper) return "";
  const losers = others.map((entity) => `${entity.name} (${entity.id})`).join(", ");
  return `Review entity merge candidate: keep ${keeper.name} (${keeper.id}); merge candidates ${losers}. Verify aliases and evidence transfers before executing through the authenticated BODHI interface.`;
}

export function EntitiesRail({
  entityTypes,
  typeFilter,
  setTypeFilter,
  subtypeFilter,
  setSubtypeFilter,
  minMentions,
  setMinMentions,
  candidates,
  onRetryCandidates,
  footer,
  className = "",
}: EntitiesRailProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<string | null>(null);
  const idPrefix = useId();
  const kindsLabelId = `${idPrefix}-entity-kinds-label`;
  const densityLabelId = `${idPrefix}-entity-density-label`;
  const candidatesLabelId = `${idPrefix}-merge-candidates-label`;

  const toggleKind = (type: string) => {
    setTypeFilter(typeFilter === type ? null : type);
    setSubtypeFilter(null);
  };

  const clusters = candidates.status === "ready" ? candidates.clusters : [];
  const visibleClusters = clusters.filter((cluster) => !dismissed.has(cluster.key));

  return (
    <div className={`flex flex-col gap-7 overflow-y-auto px-5 py-5 ${className}`}>
      <section aria-labelledby={kindsLabelId}>
        <p id={kindsLabelId} className={`${SECTION_LABEL} mb-3`}>KINDS</p>
        <div>
          {entityTypes.map(([type, count]) => {
            const active = typeFilter === type;
            const muted = typeFilter !== null && !active;
            return (
              <div key={type}>
                <button
                  type="button"
                  onClick={() => toggleKind(type)}
                  aria-pressed={active}
                  className="-mx-1.5 flex min-h-10 w-[calc(100%+0.75rem)] items-center gap-[11px] rounded-[3px] px-1.5 py-2 transition-colors duration-150 ease-precise hover:bg-stone-900/60"
                >
                  <span
                    className="h-[7px] w-[7px] flex-shrink-0 rounded-full"
                    style={{ backgroundColor: muted ? "#57575E" : (ENTITY_TYPE_COLORS[type] ?? PRODUCT_TOKEN_FALLBACK) }}
                    aria-hidden="true"
                  />
                  <span className={`flex-1 text-left text-[13px] ${active ? "text-stone-100" : muted ? "text-stone-500" : "text-stone-300"}`}>
                    {type}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-stone-500">{count}</span>
                </button>
                {active && SUBTYPES_BY_TYPE[type] && (
                  <div className="mb-1 ml-[18px]">
                    {SUBTYPES_BY_TYPE[type].map((subtype) => (
                      <button
                        key={subtype}
                        type="button"
                        onClick={() => setSubtypeFilter(subtypeFilter === subtype ? null : subtype)}
                        aria-pressed={subtypeFilter === subtype}
                        className={`block min-h-9 w-full text-left text-[12px] ${subtypeFilter === subtype ? "text-accent-amber" : "text-stone-500 hover:text-stone-300"}`}
                      >
                        {subtype}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={densityLabelId}>
        <div className="mb-2 flex items-baseline justify-between">
          <p id={densityLabelId} className={SECTION_LABEL}>MINIMUM MENTIONS</p>
          <span className="font-mono text-[11px] tabular-nums text-stone-300">{minMentions}</span>
        </div>
        <input
          aria-labelledby={densityLabelId}
          type="range"
          min={1}
          max={50}
          value={minMentions}
          onChange={(event) => setMinMentions(Number(event.target.value))}
          className="h-7 w-full cursor-pointer accent-[#8E887B]"
        />
      </section>

      <section aria-labelledby={candidatesLabelId}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p id={candidatesLabelId} className={SECTION_LABEL}>MERGE REVIEW</p>
          <span className="font-mono text-[9px] uppercase tracking-wide text-stone-500">read only</span>
        </div>
        {candidates.status === "loading" && <p className="text-[12px] text-stone-500">checking candidates…</p>}
        {candidates.status === "unavailable" && (
          <div className="space-y-2">
            <p className="font-serif text-[12px] italic text-stone-400">Candidate review is unavailable.</p>
            <button type="button" onClick={onRetryCandidates} className="min-h-9 font-mono text-[11px] text-accent-amber hover:text-stone-100">
              retry candidate check
            </button>
          </div>
        )}
        {candidates.status === "ready" && clusters.length === 0 && (
          <p className="font-serif text-[12px] italic text-stone-400">No merge candidates returned.</p>
        )}
        {candidates.status === "ready" && clusters.length > 0 && visibleClusters.length === 0 && (
          <p className="font-serif text-[12px] italic text-stone-400">All candidates are hidden for this session.</p>
        )}
        {visibleClusters.map((cluster) => {
          const [keeper, ...others] = cluster.entities;
          if (!keeper || others.length === 0) return null;
          const isReviewing = reviewing === cluster.key;
          return (
            <article key={cluster.key} className="border-b border-stone-800/60 py-3 last:border-b-0">
              <p className="text-[12px] leading-snug text-stone-200">
                Keep <span className="font-medium text-stone-100">{keeper.name}</span>
              </p>
              <p className="mt-1 text-[11px] leading-snug text-stone-400">
                Compare {others.map((entity) => entity.name).join(", ")}
              </p>
              <p className="mt-1 font-mono text-[10px] leading-relaxed text-stone-500">
                {KIND_LABEL[cluster.kind]} · {cluster.totalMentions} mentions in cluster
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setReviewing(isReviewing ? null : cluster.key)}
                  aria-expanded={isReviewing}
                  className="min-h-9 rounded-sm border border-stone-700 px-2 font-mono text-[11px] text-stone-200 hover:border-stone-500 hover:text-stone-50"
                >
                  {isReviewing ? "close request" : "preview review request"}
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((previous) => new Set(previous).add(cluster.key))}
                  className="min-h-9 px-2 font-mono text-[11px] text-stone-400 hover:text-stone-100"
                >
                  hide for session
                </button>
              </div>
              {isReviewing && (
                <div className="mt-3 rounded-sm border border-stone-800 bg-stone-900/40 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-stone-400">Request preview</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-stone-300">{candidateRequest(cluster)}</p>
                  <p className="mt-2 font-serif text-[11px] italic text-stone-400">
                    No change has been made. Ask Codex to review and execute this merge.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </section>

      {footer && <div className="mt-auto flex items-center gap-2 border-t border-stone-800/60 pt-4">{footer}</div>}
    </div>
  );
}
