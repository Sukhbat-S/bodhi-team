// ============================================================
// BODHI — Bearer-token auth middleware (C1, R, Jun 3)
// ------------------------------------------------------------
// The readiness spec (docs/security/ADVERSARY-EMULATION-READINESS.md §5, C1)
// names this as the "highest single move": every not-ready/detected-only
// kill-chain passes through the same primitive — the *unauthenticated* :4000
// API. A bearer token on the mutating routes closes the KC-1 entry, the KC-4
// flood, and the unauth confirm/write legs at the HTTP boundary in one stroke.
//
// SAFETY — DEFAULT IS A PURE PASS-THROUGH.
//   process.env.BODHI_API_AUTH !== "1"  →  no-op; nothing changes (full
//   back-compat). This is the default and is the only behavior that must be
//   preserved when the flag is unset. Auth only engages when explicitly
//   opted in via BODHI_API_AUTH=1.
//
// WHEN ENABLED (BODHI_API_AUTH=1 + BODHI_API_TOKEN set):
//   - MUTATING requests (POST/PUT/PATCH/DELETE) under /api/* must carry
//     `Authorization: Bearer <token>` matching BODHI_API_TOKEN. Missing or
//     mismatched → 401. Compared in constant time (timingSafeEqual) so the
//     check can't be turned into a byte-by-byte timing oracle.
//   - GET/HEAD/OPTIONS stay OPEN. The dashboard's read surfaces are GET-only,
//     so gating reads would break them for no security gain. (The dashboard's
//     MUTATING calls DO carry the bearer — it is baked into the bundle at BUILD
//     time from BODHI_API_TOKEN; see apps/dashboard/vite.config.ts. That bundle
//     must be rebuilt after any token rotation, or its writes 401.)
//     Confidentiality of reads is out of scope for C1 — the boundary this
//     closes is *mutation* (RCE, belief-flood, unauth writes). Reads over
//     loopback remain the single-user trust assumption.
//   - EXEMPT ALLOWLIST (open even when enabled): health/liveness probes that
//     must answer an unauthenticated monitor (EXEMPT_PATHS), plus external
//     webhook receivers that authenticate by HMAC signature in the route, not
//     the bearer (EXEMPT_PREFIXES — the gate runs before routing, so without
//     the exemption it would 401 them before their signature check runs).
//
// MISCONFIG FAIL-CLOSED: if BODHI_API_AUTH=1 but BODHI_API_TOKEN is empty,
// every mutating request is rejected (401) rather than silently allowed —
// "auth on, no secret" must never become "auth off".
//
// HOW TO ENABLE (also in docs/security/ADVERSARY-EMULATION-READINESS.md):
//   1. Pick a strong token, e.g.  openssl rand -hex 32
//   2. In .env:  BODHI_API_TOKEN=<that token>  and  BODHI_API_AUTH=1
//   3. Restart the server (and re-source env for the MCP/Bridge children).
//   The MCP client (packages/mcp-server) auto-sends the bearer when
//   BODHI_API_TOKEN is present in its env, so first-party callers keep working.
// ============================================================

import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

/** HTTP methods that mutate state and are gated when auth is enabled. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Side-effecting query flags (finding #13, defense-in-depth). A GET carrying one
 * of these (=true) performs a write and must NOT use the GET free-pass — it
 * falls through to the token check. This is a coarse, path-agnostic net for the
 * NEXT state-mutating GET someone adds; the durable fix is to use a real
 * mutating verb (see /api/entities/audit/heal, which this release already did).
 * Verified (Jun 3 grep across apps/packages/scripts): no current GET read uses
 * these words as benign filters, so this regresses nothing today.
 */
const WRITE_QUERY_FLAGS = ["heal", "backfill", "reset", "purge"];

/**
 * Exact paths that stay open even when auth is enabled — health/liveness that
 * an unauthenticated monitor must be able to reach. Kept tiny on purpose.
 * (All are GET today, so this only matters if a future probe is non-GET.)
 */
export const EXEMPT_PATHS = new Set(["/api/status"]);

/**
 * Path PREFIXES that stay open even for mutating verbs — external callers that
 * authenticate by their own axis and cannot hold the bearer. Webhook receivers
 * (GitHub/Vercel/Supabase) verify an HMAC signature inside the route handler;
 * the bearer gate runs BEFORE routing, so without this it would 401 them before
 * the signature check (latent on localhost, breaks on public exposure — exactly
 * the scenario webhooks exist for). Auth for these lives in the route, not here.
 *
 * ⚠ STALE AS OF Jul 25, 2026 — READ BEFORE TRUSTING THIS EXEMPTION.
 * `routes/webhooks.ts` was DELETED in the Wave-2 prune (see `index.ts`, "Webhook
 * routes RETIRED Jul 25"), and that commit deliberately left this entry "as a
 * defensive default". The paragraph below described that file's fail-closed
 * behaviour in the present tense; it no longer exists, so none of it protects
 * anything today.
 *
 * What survives is an auth exemption for a prefix with NO route behind it.
 * Harmless right now — requests to `/api/webhooks/*` fall through to the
 * `app.all("/api/*")` 404. But anything later mounted under this prefix
 * silently inherits an unauthenticated write path, and the next reader would
 * have believed the (now-fictional) HMAC story below.
 *
 * Left in place rather than removed: the retirement was a documented deliberate
 * decision, not an oversight. Surfaced Jul 26, 2026 for the architect to
 * confirm or drop. Original rationale (Jun 5,
 * pattern_auth_flip_breaks_offprocess_callers_jun05): webhook receivers
 * authenticate by in-route HMAC, and the bearer gate runs before routing, so
 * without the exemption they would 401 before their signature check.
 */
export const EXEMPT_PREFIXES = ["/api/webhooks/"];

/** True when the auth boundary is engaged (opt-in via env). Read per-request so a restart isn't needed to flip in tests. */
export function isApiAuthEnabled(): boolean {
  return process.env.BODHI_API_AUTH === "1";
}

/**
 * Constant-time string compare. Returns false for any length mismatch (the
 * length-prefix check is itself not secret) and otherwise compares every byte
 * regardless of where the first difference is.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the token from an `Authorization: Bearer <token>` header, or null. */
function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * Hono middleware: bearer-token gate for mutating /api/* requests.
 *
 * Pass-through (no-op) unless BODHI_API_AUTH === "1". When engaged, mutating
 * methods must present the matching bearer token; everything else (reads,
 * exempt health paths) passes untouched.
 */
/**
 * Why the reject hook is INJECTED rather than imported (Jul 26, 2026).
 *
 * `docs/SECURITY.md §0.1` item 4 asked whether rejected 401s emit anything.
 * Verified 2026-07-26: they did not — neither 401 exit below emitted, audited,
 * or even `console.log`'d, so the auth boundary could be probed indefinitely
 * leaving no trace. An arm that cannot report is decoration.
 *
 * The emitter is passed in because this module deliberately imports nothing but
 * `node:crypto` and hono types. Importing the DB layer here would couple the
 * cheapest, earliest middleware in the stack to the heaviest subsystem, and
 * would make the unit tests need a database. The caller already holds
 * `systemEvents`; it wires it at the mount site.
 */
export interface AuthRejectInfo {
  method: string;
  path: string;
  /** `no-token-configured` = fail-closed misconfig; `bad-bearer` = missing or wrong token. */
  reason: "no-token-configured" | "bad-bearer";
  /** Whether an Authorization header was present at all — distinguishes a probe from a stale client. */
  hadAuthHeader: boolean;
}

export function apiAuth(deps?: { onReject?: (info: AuthRejectInfo) => void }) {
  // A rejection is a security event; an emitter that throws must never convert a
  // clean 401 into a 500. Swallow deliberately, and never pass the presented
  // token to the hook — the whole point is to log the attempt, not the secret.
  // Resolved ONCE, outside the try, with an explicit typeof guard rather than
  // `deps?.onReject?.(info)`. The optional-chain form left two mutants alive
  // (SENTRY, Jul 26): dropping either `?.` throws a TypeError that the catch
  // below silently absorbs, so the response is 401 either way and no test can
  // tell the difference. Hoisting the guard out of the try means a dropped `?.`
  // throws where nothing catches it — every existing no-deps test then fails.
  const onReject = typeof deps?.onReject === "function" ? deps.onReject : null;
  const reject = (info: AuthRejectInfo): void => {
    if (onReject === null) return;
    try {
      onReject(info);
    } catch {
      /* best-effort: emission failure must not change the response */
    }
  };

  return async (c: Context, next: Next) => {
    // DEFAULT PATH: flag off → pure pass-through. Nothing changes.
    if (!isApiAuthEnabled()) {
      await next();
      return;
    }

    // Reads and preflight stay open — UNLESS the GET carries a side-effecting
    // write flag (?heal=true etc.), which we treat as mutating and gate. This is
    // the defense-in-depth net for the next state-mutating GET someone adds.
    const carriesWriteFlag = WRITE_QUERY_FLAGS.some(
      (f) => c.req.query(f) === "true",
    );
    if (!MUTATING_METHODS.has(c.req.method) && !carriesWriteFlag) {
      await next();
      return;
    }

    // Tiny health/liveness allowlist stays open even for mutating verbs.
    if (EXEMPT_PATHS.has(c.req.path)) {
      await next();
      return;
    }

    // External callers authenticated by their own axis (webhook HMAC) — the
    // bearer gate must not 401 them before their in-route signature check.
    if (EXEMPT_PREFIXES.some((p) => c.req.path.startsWith(p))) {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    const hadAuthHeader = typeof authHeader === "string" && authHeader.length > 0;

    const expected = process.env.BODHI_API_TOKEN ?? "";
    // Fail closed: auth on but no secret configured → reject, never allow.
    if (expected.length === 0) {
      reject({ method: c.req.method, path: c.req.path, reason: "no-token-configured", hadAuthHeader });
      return c.json(
        { error: "unauthorized", detail: "API auth enabled but no token configured" },
        401,
      );
    }

    const presented = extractBearer(authHeader);
    if (presented === null || !constantTimeEqual(presented, expected)) {
      reject({ method: c.req.method, path: c.req.path, reason: "bad-bearer", hadAuthHeader });
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
