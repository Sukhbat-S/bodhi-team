import { useEffect, useMemo, useState, type FormEvent } from "react";

interface HistorySummary {
  available: boolean;
  assistantName: string;
  conversations: number;
  reviewedEvidence: number;
  analyses: number;
  chunks: number;
  dateStart: string | null;
  dateEnd: string | null;
}

interface RecentConversation {
  source: string;
  recordId: string | null;
  title: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  turnCount: number;
  chainCompleteness: string | null;
}

interface SearchHit {
  id: string;
  source: string;
  sub_domain: string | null;
  chunk_text: string;
  title: string | null;
  similarity: number;
  metadata: Record<string, unknown> | null;
}

const EMPTY_SUMMARY: HistorySummary = {
  available: false,
  assistantName: "BODHI",
  conversations: 0,
  reviewedEvidence: 0,
  analyses: 0,
  chunks: 0,
  dateStart: null,
  dateEnd: null,
};

function dateLabel(value: string | null | undefined): string {
  if (!value) return "date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function sourceLabel(subDomain: string | null): string {
  if (subDomain === "chatgpt-conversations") return "conversation";
  if (subDomain === "reviewed-evidence") return "reviewed evidence";
  if (subDomain === "corpus-analysis") return "analysis";
  return subDomain ?? "history";
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 360 ? `${normalized.slice(0, 357)}…` : normalized;
}

export default function PersonalHistoryPage() {
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/personal-history/summary").then((response) => {
        if (!response.ok) throw new Error(`summary ${response.status}`);
        return response.json() as Promise<HistorySummary>;
      }),
      fetch("/api/personal-history/recent?limit=36").then((response) => {
        if (!response.ok) throw new Error(`recent ${response.status}`);
        return response.json() as Promise<{ conversations: RecentConversation[] }>;
      }),
    ]).then(([nextSummary, nextRecent]) => {
      if (cancelled) return;
      setSummary(nextSummary);
      setRecent(nextRecent.conversations ?? []);
    }).catch(() => {
      if (!cancelled) setError("Personal history could not be loaded. Check that BODHI is running, then retry.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const range = useMemo(() => {
    const value = summary ?? EMPTY_SUMMARY;
    return `${dateLabel(value.dateStart)} — ${dateLabel(value.dateEnd)}`;
  }, [summary]);

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery || searching) return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: nextQuery,
        domain: "personal-history",
        limit: "12",
        agent_context: "admin-personal-history",
      });
      const response = await fetch(`/api/library/search?${params}`);
      if (!response.ok) throw new Error(`search ${response.status}`);
      const data = await response.json() as { hits: SearchHit[] };
      setHits(data.hits ?? []);
      setSubmittedQuery(nextQuery);
    } catch {
      setError("Search did not complete. Verify the Voyage connection and try again.");
    } finally {
      setSearching(false);
    }
  };

  const visibleSummary = summary ?? EMPTY_SUMMARY;
  const assistantName = visibleSummary.assistantName || "BODHI";

  return (
    <div className="h-full overflow-y-auto bg-stone-950 text-stone-200">
      <div className="mx-auto grid min-h-full max-w-[1420px] grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)]">
        <aside className="border-b border-stone-800/50 px-6 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:py-10">
          <p className="font-mono text-[9px] tracking-[0.2em] text-accent-amber/80">AVAILABLE TO {assistantName.toLocaleUpperCase()}</p>
          <div className="mt-6">
            <p className="font-serif text-[58px] leading-none tracking-[-0.045em] text-stone-100">
              {loading ? "—" : visibleSummary.conversations.toLocaleString()}
            </p>
            <p className="mt-2 font-serif text-[17px] italic text-stone-500">conversations</p>
          </div>

          <div className="mt-8 border-t border-stone-800/70 pt-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-stone-600">Coverage</p>
            <p className="mt-2 font-mono text-[10px] leading-5 text-stone-400">{range}</p>
          </div>

          <dl className="mt-6 space-y-3 border-t border-stone-800/70 pt-5">
            {[
              ["Reviewed records", visibleSummary.reviewedEvidence],
              ["Analysis files", visibleSummary.analyses],
              ["Searchable passages", visibleSummary.chunks],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="text-[11px] text-stone-600">{label}</dt>
                <dd className="font-mono text-[11px] tabular-nums text-stone-300">{Number(value).toLocaleString()}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-[11px] leading-[1.65] text-stone-600">
            This archive is source evidence. Entities and confirmed memories remain curated separately.
          </p>
        </aside>

        <section className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <header className="max-w-3xl">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-stone-600">Personal history</p>
            <h1 className="mt-3 font-serif text-[30px] leading-tight tracking-[-0.015em] text-stone-100 sm:text-[36px]">
              Ask the archive, then follow the evidence.
            </h1>
            <p className="mt-3 max-w-2xl text-[13px] leading-6 text-stone-500">
              Search uses the same private retrieval path {assistantName} can use. Results retain their source layer and conversation identity.
            </p>
          </header>

          <form onSubmit={runSearch} className="mt-8 flex max-w-3xl items-stretch border-b border-stone-700/80 focus-within:border-accent-amber/70">
            <label htmlFor="history-query" className="sr-only">Search personal history</label>
            <input
              id="history-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="What did I say about…"
              className="min-w-0 flex-1 bg-transparent py-3 pr-4 font-serif text-[17px] text-stone-100 placeholder:text-stone-700 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!query.trim() || searching}
              className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-amber transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            >
              {searching ? "Searching…" : "Search →"}
            </button>
          </form>

          {error && (
            <div className="mt-6 max-w-3xl border-l border-red-400/60 pl-4 text-[12px] leading-5 text-red-300/80">{error}</div>
          )}

          {submittedQuery ? (
            <div className="mt-10 max-w-4xl">
              <div className="flex items-baseline justify-between border-b border-stone-800/70 pb-3">
                <h2 className="font-serif text-[19px] text-stone-200">Results</h2>
                <span className="font-mono text-[9px] tracking-[0.12em] text-stone-600">{hits.length} FOR “{submittedQuery.toUpperCase()}”</span>
              </div>
              {hits.length === 0 ? (
                <p className="py-10 font-serif text-[15px] italic text-stone-600">No close evidence found. Try a name, project, place, or concrete event.</p>
              ) : (
                <ol className="divide-y divide-stone-800/60">
                  {hits.map((hit) => (
                    <li key={hit.id} className="grid gap-2 py-5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-6">
                      <div>
                        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-accent-amber/70">{sourceLabel(hit.sub_domain)}</span>
                        <p className="mt-1 font-mono text-[9px] tabular-nums text-stone-700">{Math.round(hit.similarity * 100)}% match</p>
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-serif text-[16px] text-stone-300">{hit.title ?? "Untitled source"}</h3>
                        <p className="mt-2 text-[12px] leading-[1.7] text-stone-500">{excerpt(hit.chunk_text)}</p>
                        <p className="mt-2 font-mono text-[8px] text-stone-700">{dateLabel(String(hit.metadata?.date_start ?? ""))}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <div className="mt-12 max-w-4xl">
              <div className="flex items-baseline justify-between border-b border-stone-800/70 pb-3">
                <h2 className="font-serif text-[19px] text-stone-200">Archive spine</h2>
                <span className="font-mono text-[9px] tracking-[0.12em] text-stone-600">MOST RECENT {recent.length}</span>
              </div>
              {!loading && !visibleSummary.available ? (
                <p className="py-10 font-serif text-[15px] italic text-stone-600">No personal history has been imported yet.</p>
              ) : (
                <ol className="relative ml-[86px] border-l border-stone-800/80 sm:ml-[116px]">
                  {recent.map((conversation) => (
                    <li key={conversation.source} className="relative py-4 pl-7">
                      <span className="absolute -left-[121px] top-[18px] w-[98px] text-right font-mono text-[9px] tabular-nums text-stone-700 sm:-left-[151px] sm:w-[128px]">
                        {dateLabel(conversation.dateEnd)}
                      </span>
                      <span className="absolute -left-[3px] top-[21px] h-[5px] w-[5px] rounded-full bg-stone-700 ring-4 ring-stone-950" aria-hidden="true" />
                      <h3 className="font-serif text-[15px] text-stone-400">{conversation.title ?? "Untitled conversation"}</h3>
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-stone-700">
                        {conversation.turnCount.toLocaleString()} turns · {conversation.chainCompleteness ?? "source retained"}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
