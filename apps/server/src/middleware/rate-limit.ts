// ============================================================
// BODHI — In-memory token-bucket rate limiter (C7a, R, Jun 3)
// ------------------------------------------------------------
// Closes the KC-4 machine-paced-write amplification: the readiness spec
// (docs/security/ADVERSARY-EMULATION-READINESS.md §4) names "Zero rate-limit /
// 429 / throttle code" as the control that fails against an adversary issuing
// "thousands of semantically-distinct poisoned writes per second". This caps
// burst on the substrate-mutating write endpoints.
//
// No new deps — a plain in-process token bucket. BODHI is single-user and
// loopback-only, so limits are GENEROUS: the goal is to break an automated
// flood, not to throttle a human (or the orchestrator's normal batched writes).
// A token bucket lets short legitimate bursts through (capacity) while bounding
// the sustained rate (refill). When the bucket is empty → HTTP 429.
//
// Keyed per-bucket-name (the route class), process-global — single-user means
// there's no per-tenant axis to split on. State is a Map; it's bounded by the
// number of registered buckets (3), so there's no unbounded-growth leak.
// ============================================================

import type { Context, Next } from "hono";

/**
 * Limits per write-endpoint class. GENEROUS by design (single-user, loopback).
 * `capacity` = max burst (tokens available when full); `refillPerSec` = sustained
 * tokens granted per second. A human or the orchestrator's normal cadence stays
 * far under these; a machine-paced flood (hundreds–thousands/sec) trips 429.
 */
export const RATE_LIMITS = {
  /** /api/memories — the KC-4 belief-flood target. */
  memories: { capacity: 60, refillPerSec: 10 },
  /** /api/agent-dispatches — forensic-row writes. */
  "agent-dispatches": { capacity: 60, refillPerSec: 10 },
  /** /api/sessions/messages — cross-tab coordination. */
  "sessions-messages": { capacity: 60, refillPerSec: 10 },
  /** Provider-neutral checkpoint mutations and verification receipts. */
  checkpoints: { capacity: 30, refillPerSec: 5 },
  /**
   * #11 resource-exhaustion (Jun 4): embedding-bearing GET reads
   * (/api/memories/search + /api/library/search). Each cache-miss query
   * fires a PAID Voyage embedding call; a varied ?q= bypasses the exact-text
   * cache every time, so a loop = N paid network calls with no 429. Tighter
   * than the write buckets because the dominant cost is the per-request
   * Voyage API call (not a local write): capacity 30 burst, 2/s sustained
   * trips a machine-paced flood well before it becomes a cost vector, while
   * leaving a human's / the orchestrator's normal search cadence untouched.
   */
  "search-embed": { capacity: 30, refillPerSec: 2 },
} as const satisfies Record<string, { capacity: number; refillPerSec: number }>;

export type RateLimitBucketName = keyof typeof RATE_LIMITS;

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, BucketState>();

/** Test hook — reset all bucket state between cases. */
export function _resetRateLimits(): void {
  buckets.clear();
}

/**
 * Pure-ish token-bucket check. Refills lazily based on elapsed time, then
 * consumes one token. Returns true if the request is allowed (token consumed),
 * false if the bucket is empty (→ 429). Exported for direct unit testing.
 */
export function takeToken(name: RateLimitBucketName, nowMs = Date.now()): boolean {
  const limit = RATE_LIMITS[name];
  let b = buckets.get(name);
  if (!b) {
    b = { tokens: limit.capacity, lastRefillMs: nowMs };
    buckets.set(name, b);
  }
  // Lazy refill: add tokens for the time elapsed since the last refill, capped
  // at capacity.
  const elapsedSec = (nowMs - b.lastRefillMs) / 1000;
  if (elapsedSec > 0) {
    b.tokens = Math.min(limit.capacity, b.tokens + elapsedSec * limit.refillPerSec);
    b.lastRefillMs = nowMs;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Hono middleware factory. Returns a middleware that consumes one token from the
 * named bucket per request and short-circuits with 429 when the bucket is empty.
 * Register it on the write route(s) for that bucket (e.g. POST /api/memories).
 */
export function rateLimit(name: RateLimitBucketName) {
  return async (c: Context, next: Next) => {
    if (!takeToken(name)) {
      return c.json(
        { error: "rate limit exceeded", retryAfter: 1 },
        429,
        { "Retry-After": "1" },
      );
    }
    await next();
  };
}
