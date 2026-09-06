// ============================================================
// BODHI — Offline-error classifier (centralized Jul 17)
//
// A sleeping/offline Mac throws network errors on any cron that reaches out
// (embedding providers or OAuth services) — that is the HOST being off, NOT a
// job failure. A
// job that hits one of these should record a quiet status:'skipped',
// reason:'offline' instead of a warn/error event.
//
// This is the single source of truth and intentionally remains a dependency
// leaf (no imports), so scheduler.ts and retained jobs can share it without a
// circular dependency.
//
// CONSERVATIVE BY DESIGN: only the tokens below match; ANY other error is a
// genuine failure and still emits the normal error event. A too-broad matcher
// would MASK real breakage — the one correctness risk here — so the default is
// "this is a real error". The list is the UNION of the two prior network-only
// copies; the deliberately-broader library matcher keeps its own extra tokens.
// Matches the message OR (for node socket errors) the `.code` field.
// ============================================================

export const OFFLINE_ERROR_TOKENS = [
  "ENOTFOUND",
  "getaddrinfo",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  // Deliberately "fetch failed after" (the retry-wrapper's EXHAUSTION message),
  // NOT bare "fetch failed" (undici's generic top-level message for refused/
  // reset/TLS alike) — guardCron applies this list to EVERY cron, and the bare
  // token would silently downgrade real fetch failures to skipped/offline.
  "fetch failed after",
  "timed out after",
] as const;

export function isOfflineError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  return OFFLINE_ERROR_TOKENS.some(
    (tok) => msg.includes(tok) || (code !== "" && code === tok),
  );
}
