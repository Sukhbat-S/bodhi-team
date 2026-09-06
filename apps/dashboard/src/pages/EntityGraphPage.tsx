import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  EntitiesRail,
  type MergeCandidateState,
} from "../components/entities/EntitiesRail";
import { EntityListFallback } from "../components/EntityListFallback";
import { EntityThread } from "../components/EntityThread";
import { EntityActivityRibbon } from "../components/EntityActivityRibbon";
import { EmergingGoals } from "../components/EmergingGoals";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { EntityGraph2D, type EntityGraph2DHandle } from "../components/EntityGraph2D";
import { TimeStrip, type TimeWindow, type LifeLine } from "../components/entities/TimeStrip";
import { DayDrawer } from "../components/entities/DayDrawer";
import { getMemoryHistogram, type MemoryHistogramDay } from "../api";
import {
  dayKeyInTimeZone,
  isEntityDetailResponse,
  isEntityGraphResponse,
  isEntityStatsResponse,
  isMemoryHistogramResponse,
  isMergeCandidatesResponse,
  type EntityDetailRecord,
  type EntityEdgeRecord,
  type EntityRecord,
} from "../lib/entityEvidence";
import { entityEscapeLayer } from "../lib/entityInteraction";

const KIND_COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

type GraphSnapshot = {
  nodes: EntityRecord[];
  edges: EntityEdgeRecord[];
  stats: { total: number; byType: Record<string, number> };
  minMentions: number;
};

type GraphState = "loading" | "ready" | "unavailable";
type HistogramState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; days: MemoryHistogramDay[]; timeZone: string };

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

export default function EntityGraphPage() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [graphState, setGraphState] = useState<GraphState>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [subtypeFilter, setSubtypeFilter] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MergeCandidateState>({ status: "loading" });
  const [railOpen, setRailOpen] = useState(false);
  const [canvasAvailable, setCanvasAvailable] = useState(true);
  const [forceList, setForceList] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "list" || window.matchMedia?.("(max-width: 639px)").matches === true;
  });
  const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [histogram, setHistogram] = useState<HistogramState>({ status: "loading" });
  const [minMentions, setMinMentions] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem("entityGraph.minMentions") || "30", 10);
    return Number.isFinite(saved) && saved >= 1 ? saved : 30;
  });
  const densityMigrationPending = useRef(localStorage.getItem("entityGraph.densityPolicy") !== "small-corpus-v1");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EntityGraph2DHandle | null>(null);
  const detailRequestRef = useRef(0);
  const graphRequestRef = useRef(0);
  const timelineSeededRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dayReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      setCanvasAvailable(Boolean(document.createElement("canvas").getContext("2d")));
    } catch {
      setCanvasAvailable(false);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 639px)");
    if (!media) return;
    const handler = (event: MediaQueryListEvent) => { if (event.matches) setForceList(true); };
    media.addEventListener?.("change", handler);
    return () => media.removeEventListener?.("change", handler);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const loadGraph = useCallback(async () => {
    const requestId = ++graphRequestRef.current;
    setGraphState("loading");
    try {
      const [graph, stats] = await Promise.all([
        fetchJson(`/api/entities/graph?minMentions=${minMentions}`),
        fetchJson("/api/entities/stats"),
      ]);
      if (!isEntityGraphResponse(graph) || !isEntityStatsResponse(stats)) throw new Error("invalid entity response");
      if (graphRequestRef.current !== requestId) return;
      setSnapshot({ ...graph, stats, minMentions });
      setGraphState("ready");
      if (densityMigrationPending.current) {
        if (stats.total <= 50 && minMentions === 30) setMinMentions(1);
        localStorage.setItem("entityGraph.densityPolicy", "small-corpus-v1");
        densityMigrationPending.current = false;
      }
    } catch (error) {
      if (graphRequestRef.current === requestId) {
        console.error("Failed to load entities:", error);
        setGraphState("unavailable");
      }
    }
  }, [minMentions]);

  useEffect(() => { void loadGraph(); }, [loadGraph]);
  useEffect(() => { localStorage.setItem("entityGraph.minMentions", String(minMentions)); }, [minMentions]);

  const loadCandidates = useCallback(async () => {
    setCandidates({ status: "loading" });
    try {
      const result = await fetchJson("/api/entities/merge-candidates");
      if (!isMergeCandidatesResponse(result)) throw new Error("invalid merge candidates response");
      setCandidates({ status: "ready", clusters: result.clusters });
    } catch {
      setCandidates({ status: "unavailable" });
    }
  }, []);

  useEffect(() => { void loadCandidates(); }, [loadCandidates]);

  const loadHistogram = useCallback(async () => {
    setHistogram({ status: "loading" });
    try {
      const result = await getMemoryHistogram(90);
      if (!isMemoryHistogramResponse(result)) throw new Error("invalid histogram timezone contract");
      setHistogram({ status: "ready", days: result.days, timeZone: result.timeZone });
    } catch {
      setHistogram({ status: "unavailable" });
      setTimeWindow(null);
      setSelectedDay(null);
    }
  }, []);

  useEffect(() => { void loadHistogram(); }, [loadHistogram]);

  useEffect(() => {
    if (histogram.status !== "ready" || timelineSeededRef.current) return;
    timelineSeededRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== "timeline") return;
    setSelectedDay(dayKeyInTimeZone(new Date(), histogram.timeZone));
  }, [histogram]);

  const graphData = snapshot ?? { nodes: [], edges: [], stats: { total: 0, byType: {} }, minMentions };
  const timeZone = histogram.status === "ready" ? histogram.timeZone : null;

  const filteredData = useMemo(() => {
    let nodes = graphData.nodes;
    if (typeFilter) nodes = nodes.filter((node) => node.type === typeFilter);
    if (subtypeFilter) nodes = nodes.filter((node) => node.subtype === subtypeFilter);
    if (timeWindow && timeZone) {
      nodes = nodes.filter((node) => {
        if (!node.lastSeenAt) return true;
        const last = dayKeyInTimeZone(node.lastSeenAt, timeZone);
        const first = dayKeyInTimeZone(node.firstSeenAt ?? node.lastSeenAt, timeZone);
        return !last || !first || (last >= timeWindow.start && first <= timeWindow.end);
      });
    }
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: graphData.edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId)) };
  }, [graphData.edges, graphData.nodes, subtypeFilter, timeWindow, timeZone, typeFilter]);

  const graphNodes = useMemo(() => filteredData.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    mentionCount: node.mentionCount,
    firstSeenAt: node.firstSeenAt,
    lastSeenAt: node.lastSeenAt,
  })), [filteredData.nodes]);
  const graphLinks = useMemo(() => filteredData.edges.map((edge) => ({
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    value: edge.sharedMemoryCount,
  })), [filteredData.edges]);

  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    if (candidates.status === "ready") {
      candidates.clusters.forEach((cluster) => cluster.entities.forEach((entity) => ids.add(entity.id)));
    }
    return ids;
  }, [candidates]);

  const relatedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredData.edges.forEach((edge) => {
      counts.set(edge.sourceId, (counts.get(edge.sourceId) ?? 0) + 1);
      counts.set(edge.targetId, (counts.get(edge.targetId) ?? 0) + 1);
    });
    return counts;
  }, [filteredData.edges]);

  const placeholder = useCallback((id: string): EntityDetailRecord | null => {
    const node = graphData.nodes.find((candidate) => candidate.id === id);
    return node ? { ...node, memories: [], relatedEntities: [] } : null;
  }, [graphData.nodes]);

  const handleNavigate = useCallback(async (id: string) => {
    const requestId = ++detailRequestRef.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
    setDetail(placeholder(id));
    setDetailLoading(true);
    setDetailUnavailable(false);
    try {
      const result = await fetchJson(`/api/entities/${encodeURIComponent(id)}`);
      if (!isEntityDetailResponse(result, id)) throw new Error("invalid entity detail response");
      if (detailRequestRef.current === requestId) setDetail(result);
    } catch {
      if (detailRequestRef.current === requestId) setDetailUnavailable(true);
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  }, [placeholder]);

  const restoreFocus = (target: React.MutableRefObject<HTMLElement | null>) => {
    const element = target.current;
    target.current = null;
    window.requestAnimationFrame(() => element?.focus());
  };

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setDetail(null);
    setSelectedId(null);
    setDetailLoading(false);
    setDetailUnavailable(false);
    restoreFocus(returnFocusRef);
  }, []);

  const selectDay = useCallback((day: string) => {
    dayReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedDay(day);
  }, []);

  const closeDay = useCallback(() => {
    setSelectedDay(null);
    restoreFocus(dayReturnFocusRef);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const layer = entityEscapeLayer({
        detailVisible: Boolean(selectedId || detail),
        dayVisible: Boolean(selectedDay),
        rangeActive: Boolean(timeWindow),
      });
      if (layer === "detail") closeDetail();
      else if (layer === "day") closeDay();
      else if (layer === "range") setTimeWindow(null);
      else return;
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closeDay, closeDetail, detail, selectedDay, selectedId, timeWindow]);

  const lifeLine = useMemo<LifeLine | null>(() => {
    if (!selectedId || !detail || detail.id !== selectedId || !timeZone) return null;
    const mentionDays = detail.memories
      .map((memory) => dayKeyInTimeZone(memory.createdAt, timeZone))
      .filter((day): day is string => Boolean(day));
    return {
      name: detail.name,
      firstSeenAt: detail.firstSeenAt ?? null,
      lastSeenAt: detail.lastSeenAt ?? null,
      mentionCount: detail.mentionCount,
      mentionDays: [...new Set(mentionDays)],
    };
  }, [detail, selectedId, timeZone]);

  const entityTypes = useMemo(() => Object.entries(graphData.stats.byType).sort(([, a], [, b]) => b - a), [graphData.stats.byType]);
  const listMode = !canvasAvailable || forceList;
  const filteredToNothing = snapshot !== null && graphState !== "unavailable" && graphData.nodes.length > 0 && filteredData.nodes.length === 0;
  const staleSnapshot = graphState === "unavailable" && snapshot !== null;

  const railProps = {
    entityTypes,
    typeFilter,
    setTypeFilter,
    subtypeFilter,
    setSubtypeFilter,
    minMentions,
    setMinMentions,
    candidates,
    onRetryCandidates: loadCandidates,
  };

  return (
    <div className="flex h-full flex-col bg-stone-950">
      <div className="flex flex-shrink-0 flex-col gap-3 px-4 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2 sm:gap-3">
          <h1 className="font-serif text-[20px] text-stone-100">Entities</h1>
          {snapshot && (
            <span className="font-mono text-[11px] tabular-nums text-stone-400">
              {graphData.stats.total.toLocaleString("en-US")} across {KIND_COUNT_WORDS[entityTypes.length] ?? entityTypes.length} kinds · {filteredData.nodes.length} in view
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setRailOpen((open) => !open)} aria-expanded={railOpen} className={`min-h-10 rounded-sm border border-stone-700 px-3 font-mono text-[11px] md:hidden ${railOpen ? "bg-stone-100/5 text-stone-100" : "text-stone-300"}`}>filters & review</button>
          {(["graph", "list"] as const).map((view) => {
            const active = view === "list" ? forceList : !forceList;
            return (
              <button key={view} type="button" onClick={() => setForceList(view === "list")} aria-pressed={active} className={`min-h-10 rounded-sm border border-stone-700 px-3 font-mono text-[11px] ${active ? "bg-stone-100/5 text-stone-100" : "text-stone-300 hover:text-stone-100"}`}>{view}</button>
            );
          })}
        </div>
      </div>

      <EmergingGoals onSelectEntity={handleNavigate} days={30} limit={4} />

      {railOpen && <EntitiesRail {...railProps} className="max-h-[55vh] flex-shrink-0 border-b border-stone-800/60 md:hidden" />}

      <div className="flex min-h-0 flex-1">
        <EntitiesRail
          {...railProps}
          footer={<button type="button" onClick={() => void loadGraph()} className="ml-auto min-h-9 font-mono text-[11px] text-stone-300 hover:text-stone-100">refresh entities</button>}
          className="hidden w-[232px] flex-shrink-0 border-r border-stone-800/60 md:flex"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {graphState === "loading" && snapshot && (
            <div role="status" className="border-b border-stone-800 bg-stone-900/40 px-4 py-2 text-[11px] text-stone-300 sm:px-6">
              Refreshing for minimum {minMentions} mentions · showing the last successful view for minimum {snapshot.minMentions}.
            </div>
          )}
          {staleSnapshot && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-800 bg-stone-900/50 px-4 py-2 text-[11px] text-stone-300 sm:px-6">
              <span>Entities are unavailable. Showing the last successful view for minimum {snapshot.minMentions} mentions.</span>
              <button type="button" onClick={() => void loadGraph()} className="min-h-9 font-mono text-accent-amber hover:text-stone-100">retry</button>
            </div>
          )}
          <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
            {listMode && filteredData.nodes.length > 0 && (
              <EntityListFallback
                nodes={filteredData.nodes}
                relatedCounts={relatedCounts}
                duplicateIds={duplicateIds}
                onDedupClick={() => setRailOpen(true)}
                selectedId={selectedId}
                onSelect={handleNavigate}
                headerSlot={<EntityActivityRibbon onSelectEntity={handleNavigate} limit={8} />}
              />
            )}

            {!listMode && graphNodes.length > 0 && containerSize.width > 0 && (
              <ErrorBoundary fallback={null} onError={(error) => { console.error("Entity graph unavailable:", error); setForceList(true); }}>
                <EntityGraph2D
                  ref={graphRef}
                  nodes={graphNodes}
                  links={graphLinks}
                  width={containerSize.width}
                  height={containerSize.height}
                  selectedId={selectedId}
                  onNodeClick={handleNavigate}
                  onBackgroundClick={closeDetail}
                />
              </ErrorBoundary>
            )}

            {graphState === "loading" && !snapshot && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="font-serif text-[13px] italic text-stone-400">Loading entities…</span></div>
            )}
            {graphState === "unavailable" && !snapshot && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <p className="font-serif text-[14px] italic text-stone-300">Entities are unavailable.</p>
                <button type="button" onClick={() => void loadGraph()} className="min-h-10 font-mono text-[11px] text-accent-amber hover:text-stone-100">retry</button>
              </div>
            )}
            {graphState === "ready" && graphData.nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><p className="font-serif text-[15px] italic text-stone-400">No entities were returned.</p></div>
            )}
            {filteredToNothing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <p className="font-serif text-[14px] italic text-stone-300">No entities match · {graphData.nodes.length} hidden by filters</p>
                <button type="button" onClick={() => { setTypeFilter(null); setSubtypeFilter(null); setTimeWindow(null); }} className="min-h-10 font-mono text-[11px] text-accent-amber hover:text-stone-100">clear filters</button>
              </div>
            )}

            {selectedId && !detail && detailLoading && (
              <aside className="absolute inset-0 z-40 flex items-center justify-center bg-[#121215] sm:bottom-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[372px]" aria-label="Loading entity details">
                <p className="font-serif text-[13px] italic text-stone-400">Loading entity details…</p>
              </aside>
            )}
            {selectedId && !detail && detailUnavailable && (
              <aside className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[#121215] px-5 sm:bottom-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[372px]" aria-label="Entity details unavailable">
                <p className="font-serif text-[13px] italic text-stone-300">Entity details are unavailable.</p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => void handleNavigate(selectedId)} className="min-h-10 font-mono text-[11px] text-accent-amber hover:text-stone-100">retry</button>
                  <button type="button" onClick={closeDetail} className="min-h-10 font-mono text-[11px] text-stone-300 hover:text-stone-100">close</button>
                </div>
              </aside>
            )}

            <AnimatePresence>
              {detail && (
                <EntityThread entity={detail} timeZone={timeZone} loading={detailLoading} unavailable={detailUnavailable} onClose={closeDetail} onNavigate={handleNavigate} />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {selectedDay && timeZone && (
                <DayDrawer key={selectedDay} date={selectedDay} timeZone={timeZone} onClose={closeDay} onHoverEntities={(ids) => graphRef.current?.pulseNodes(ids)} onSelectEntity={handleNavigate} />
              )}
            </AnimatePresence>
          </div>

          <TimeStrip
            days={histogram.status === "ready" ? histogram.days : []}
            timeZone={timeZone}
            evidenceStatus={histogram.status}
            onRetry={loadHistogram}
            window={timeWindow}
            onWindowChange={setTimeWindow}
            selectedDay={selectedDay}
            onSelectDay={selectDay}
            lifeLine={lifeLine}
          />
        </div>
      </div>
    </div>
  );
}
