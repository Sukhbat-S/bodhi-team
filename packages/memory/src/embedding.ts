// ============================================================
// BODHI — Voyage AI Embedding Client
//
// - Uses fetchWithRetry for transient-failure resilience.
// - TTL LRU cache on embedSingle() so identical retrieval queries
//   (briefings, repeated chat messages, synthesis re-runs) don't
//   re-embed. Typical pattern: "pending example" queried 10×/day.
//   Cache key = text + model. Cache hit = zero Voyage API calls.
// ============================================================

import { fetchWithRetry } from "./fetch-with-retry.js";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4-lite";
const DIMENSIONS = 1024;

// ------- Embedding cache (single-text queries only) -------

const EMBED_CACHE_MAX = 200;
const EMBED_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

interface CacheEntry {
  embedding: number[];
  expiresAt: number;
}

const embedCache = new Map<string, CacheEntry>();

function cacheKey(text: string, model: string): string {
  return `${model}::${text}`;
}

function cacheGet(key: string): number[] | null {
  const entry = embedCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    embedCache.delete(key);
    return null;
  }
  // Move-to-end for LRU
  embedCache.delete(key);
  embedCache.set(key, entry);
  return entry.embedding;
}

function cacheSet(key: string, embedding: number[]): void {
  if (embedCache.size >= EMBED_CACHE_MAX) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
  embedCache.set(key, {
    embedding,
    expiresAt: Date.now() + EMBED_CACHE_TTL_MS,
  });
}

// ------- Embed API -------

export async function embed(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const response = await fetchWithRetry(
    VOYAGE_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: MODEL,
      }),
    },
    {
      maxRetries: 3,
      timeoutMs: 30_000,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage AI embedding error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data.map((d) => d.embedding);
}

export async function embedSingle(text: string, apiKey: string): Promise<number[]> {
  const key = cacheKey(text, MODEL);
  const cached = cacheGet(key);
  if (cached) return cached;

  const [embedding] = await embed([text], apiKey);
  cacheSet(key, embedding);
  return embedding;
}

/** Test helper — clears the embed cache. */
export function _clearEmbedCache(): void {
  embedCache.clear();
}

export { DIMENSIONS };
