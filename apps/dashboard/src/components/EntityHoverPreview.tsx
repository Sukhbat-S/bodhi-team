// ============================================================
// EntityHoverPreview — DESIGN.md §12.3 Connection over enumeration
// ============================================================
//
// Phase B C2 (May 9 evening). Small floating preview that fades in
// when a list row is hovered. Two lines:
//   - first 80 chars of the most recent source memory
//   - "+ N related" count
//
// Lazy-fetches the entity's detail on first appearance, caches in
// a module-level Map for the session. No prefetch on list render
// (would burn a request per row).

import { useEffect, useRef, useState } from "react";

interface MemorySnippet {
  content: string;
  createdAt: string;
}

export interface EntityPreviewData {
  status: "ready" | "unavailable";
  recentMemory: MemorySnippet | null;
}

const previewCache = new Map<string, EntityPreviewData>();
const inflightRequests = new Map<string, Promise<EntityPreviewData>>();

/** Test seam: drop all memoised previews so a test starts from a cold cache. */
export function __resetPreviewCacheForTests(): void {
  previewCache.clear();
  inflightRequests.clear();
}

export async function fetchPreview(entityId: string): Promise<EntityPreviewData> {
  if (previewCache.has(entityId)) return previewCache.get(entityId)!;
  if (inflightRequests.has(entityId)) return inflightRequests.get(entityId)!;

  const promise = fetch(`/api/entities/${entityId}/memories?limit=1`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
    .then((data: { memories: Array<{ content: string; createdAt: string }> }) => {
      if (!data || !Array.isArray(data.memories)) throw new Error("invalid memories response");
      const first = data.memories[0];
      if (first && (typeof first.content !== "string" || typeof first.createdAt !== "string")) {
        throw new Error("invalid memory preview");
      }
      const result: EntityPreviewData = {
        status: "ready",
        recentMemory: first ?? null,
      };
      previewCache.set(entityId, result);
      return result;
    })
    .catch(() => {
      // Do NOT memoise a failure. This used to `previewCache.set(entityId, empty)`, so a
      // single transient 500 / offline blip / server restart pinned that entity to
      // "no recent memory" for the LIFETIME OF THE PAGE — every later hover was a cache
      // HIT and never retried. Return the empty shape for this call only; the next hover
      // re-fetches. (`finally` still clears the in-flight entry, so no request is leaked.)
      return { status: "unavailable", recentMemory: null } as EntityPreviewData;
    })
    .finally(() => {
      inflightRequests.delete(entityId);
    });

  inflightRequests.set(entityId, promise);
  return promise;
}

function formatAge(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface EntityHoverPreviewProps {
  entityId: string;
  relatedCount: number;
}

export function EntityHoverPreview(props: EntityHoverPreviewProps) {
  // Preview state belongs to the entity, even when the floating caller is reused.
  return <EntityHoverPreviewContent key={props.entityId} {...props} />;
}

function EntityHoverPreviewContent({ entityId, relatedCount }: EntityHoverPreviewProps) {
  const [data, setData] = useState<EntityPreviewData | null>(() => previewCache.get(entityId) ?? null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (data) return;
    cancelRef.current = false;
    fetchPreview(entityId).then((d) => {
      if (!cancelRef.current) setData(d);
    });
    return () => {
      cancelRef.current = true;
    };
  }, [entityId, data]);

  return (
    <div className="pointer-events-none w-72 rounded-md border border-stone-800/80 bg-stone-950/95 px-4 py-3 shadow-xl backdrop-blur-md animate-morning-arrival">
      {data?.status === "ready" && data.recentMemory ? (
        <>
          <p className="mb-1.5 line-clamp-2 text-[12px] leading-snug text-stone-300">
            {data.recentMemory.content.length > 90
              ? `${data.recentMemory.content.slice(0, 90)}…`
              : data.recentMemory.content}
          </p>
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-stone-600">
            <span>{formatAge(data.recentMemory.createdAt)}</span>
            {relatedCount > 0 && (
              <span>
                {relatedCount} related shown
              </span>
            )}
          </div>
        </>
      ) : data?.status === "ready" ? (
        <p className="text-[11px] italic text-stone-500">No memory yet.</p>
      ) : data?.status === "unavailable" ? (
        <p className="text-[11px] italic text-stone-400">Memory preview unavailable.</p>
      ) : (
        <p className="text-[11px] italic text-stone-700">…</p>
      )}
    </div>
  );
}
