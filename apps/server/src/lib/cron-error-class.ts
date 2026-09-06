// ============================================================
// BODHI — cron-error actionability classifier (Jul 9, 2026)
//
// Splits the job-stats error stream into two actionable classes:
//   - FAULT     — a real, code/instrument-level failure worth surfacing
//                 as the dashboard headline (e.g. sentry-nightly Stryker
//                 exited 1, a broken cron).
//   - TRANSIENT — self-healing / offline noise: DNS/socket failures on a
//                 sleeping laptop, an unloaded Google token. The Wave-1
//                 fix (commit 01f7cbd) made architect-mode-sync quiet-skip
//                 these going-forward (severity=info, no longer counted),
//                 but ~440 historical hard-error rows predate that fix and
//                 must NOT masquerade as real faults in the headline count.
//
// The historical rows carry NO structured marker (emitJobEvent writes
// `status`/`reason`, never `outcome`; verified 0 rows with outcome='skipped'
// among errors) — so the discriminator is the MESSAGE SIGNATURE. Post-fix
// skips also carry status='skipped'/reason='offline', kept here defensively.
//
// One alternation source, used by BOTH the SQL FILTER (briefings.ts
// job-stats) and the JS predicate below, so the classification can't drift
// between the query and the tests.
// ============================================================

// POSIX- and JS-regex-compatible alternation (no anchors, no lookahead) —
// safe to embed in a Postgres `~*` operator AND a JS `new RegExp(src, "i")`.
export const TRANSIENT_ERROR_SIGNATURE =
  "(getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|" +
  "socket hang up|failed, reason:|fetch failed|network timeout|timed out|" +
  "No refresh token|No access, refresh token)";

const TRANSIENT_RE = new RegExp(TRANSIENT_ERROR_SIGNATURE, "i");

/**
 * True when a cron error row is transient/offline noise rather than a real
 * fault. `msg` is the row's `payload.error` (falling back to `summary`);
 * `status`/`reason`/`outcome` are payload markers set by post-fix quiet-skips.
 */
export function isTransientCronError(
  msg: string | null | undefined,
  markers?: { status?: string | null; reason?: string | null; outcome?: string | null },
): boolean {
  if (markers) {
    if (markers.outcome === "skipped" || markers.status === "skipped") return true;
    if (markers.reason === "offline") return true;
  }
  if (!msg) return false;
  return TRANSIENT_RE.test(msg);
}
