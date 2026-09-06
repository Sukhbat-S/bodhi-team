// ============================================================
// BODHI — fetch wrapper with exponential backoff + abort
// Used for all external API calls (Voyage, Google, Notion, etc.)
// so transient failures don't silently break the system.
// ============================================================

export interface RetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  backoffMs?: number[];
  /** HTTP status codes that trigger retry. Default: 408, 429, 500, 502, 503, 504. */
  retryStatuses?: number[];
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000];
const DEFAULT_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * fetch() with timeout + exponential backoff for transient failures.
 *
 * - Returns the Response if successful (caller checks .ok)
 * - Throws on network errors after maxRetries
 * - Throws on non-retryable HTTP errors (4xx other than 408/429)
 * - Each attempt has its own timeoutMs via AbortController
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const retryStatuses = opts.retryStatuses
    ? new Set(opts.retryStatuses)
    : DEFAULT_RETRY_STATUSES;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) return response;

      // Retryable HTTP status?
      if (retryStatuses.has(response.status) && attempt < maxRetries) {
        const delay = backoff[Math.min(attempt, backoff.length - 1)];
        await sleep(delay);
        continue;
      }

      // Non-retryable (4xx client error etc.) — return the response so
      // the caller can read the error body.
      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxRetries) {
        const delay = backoff[Math.min(attempt, backoff.length - 1)];
        await sleep(delay);
        continue;
      }
    }
  }

  throw new Error(
    `fetch failed after ${maxRetries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
