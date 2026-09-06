// ============================================================
// BODHI — EntityHoverPreview fetch cache (Jul 10)
//
// fetchPreview memoised SUCCESS and FAILURE alike: the .catch() wrote
// { recentMemory: null } into previewCache, so one transient 500 pinned that entity to
// "no recent memory" for the lifetime of the page — every later hover hit the cache and
// never retried. Same family as the day's other silent-wrong-answer bugs.
//
// These tests FAIL against the caching-on-error version.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPreview, __resetPreviewCacheForTests } from "./EntityHoverPreview.js";

const realFetch = globalThis.fetch;

function mockFetchOnce(impl: () => Promise<unknown>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => __resetPreviewCacheForTests());
afterEach(() => { globalThis.fetch = realFetch; });

describe("fetchPreview — a failed request must not be memoised", () => {
  it("recovers on the next call after a transient failure", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 500 } as Response;
      return {
        ok: true,
        json: async () => ({ memories: [{ content: "hello", createdAt: "2026-07-10T00:00:00Z" }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const first = await fetchPreview("e1");
    expect(first).toEqual({ status: "unavailable", recentMemory: null });

    const second = await fetchPreview("e1");
    expect(second.status).toBe("ready");
    expect(second.recentMemory?.content).toBe("hello"); // OLD CODE: still null, cache hit
    expect(call).toBe(2); // OLD CODE: 1 — never re-fetched
  });

  it("a SUCCESS is still memoised (one request for two hovers)", async () => {
    const f = mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ memories: [{ content: "cached", createdAt: "2026-07-10T00:00:00Z" }] }),
    }));
    await fetchPreview("e2");
    await fetchPreview("e2");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("an empty-but-successful response is memoised (absence of data is a real answer)", async () => {
    const f = mockFetchOnce(async () => ({ ok: true, json: async () => ({ memories: [] }) }));
    expect(await fetchPreview("e3")).toEqual({ status: "ready", recentMemory: null });
    await fetchPreview("e3");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
