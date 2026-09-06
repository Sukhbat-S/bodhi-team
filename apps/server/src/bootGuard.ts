// ============================================================
// BODHI — Boot guard: fail-closed on a public bind (Phase ④ / R3 #2)
// ------------------------------------------------------------
// The single-user assumption is "loopback-only, no auth needed". The danger is a
// clone/fork that flips the bind host to a public interface (0.0.0.0, a LAN IP,
// a hostname) while leaving auth OFF — that silently turns the unauthenticated
// :4000 API into a live victim on the network.
//
// This module is a PURE decision function (no process state, no I/O) so the
// boundary can be re-proven by direct invocation in tests. index.ts calls it
// right before serve() and exits(1) on refusal.
//
// SAFETY — the default is unchanged: host 127.0.0.1 with auth off → allowed.
// Every non-loopback bind is refused, independently of write authentication.
// ============================================================

/** Loopback hosts that are safe to bind without auth (single-user dev/VPS). */
const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  // IPv4-mapped IPv6 loopback, both bracketed and bare forms.
  "::ffff:127.0.0.1",
  "[::1]",
]);

/**
 * True when `host` binds to loopback only (not reachable off the machine).
 * Comparison is case-insensitive and trims an optional trailing zone/port-free
 * bracket form. Anything not explicitly loopback is treated as PUBLIC — the
 * conservative direction (an unknown host must not be assumed safe).
 */
export function isLoopbackHost(host: string | undefined | null): boolean {
  if (host === undefined || host === null) {
    // No explicit host → index.ts binds 127.0.0.1 (loopback). Safe.
    return true;
  }
  const h = host.trim().toLowerCase();
  if (h === "") return true; // empty → defaults to loopback bind
  return LOOPBACK_HOSTS.has(h);
}

export interface BootGuardDecision {
  /** Whether the server is allowed to start. */
  allowed: boolean;
  /** Human-readable reason (only meaningful when allowed === false). */
  reason: string;
}

/** BODHI remains a local service; write authentication is not public-read security. */
export function evaluateBootGuard(
  host: string | undefined | null,
  _authEnabled: boolean,
): BootGuardDecision {
  if (!isLoopbackHost(host)) {
    return {
      allowed: false,
      reason: `Refusing to start: bind host "${host}" is NOT loopback. BODHI_API_AUTH protects writes but does not make public hosting supported. Bind to loopback; public deployment requires a separate security model.`,
    };
  }
  return { allowed: true, reason: "" };
}
