// ============================================================
// Scheduler — shared URL + headers for first-party /api/* calls
// ------------------------------------------------------------
// MED-1 (C1 follow-up, Jun 3) extracted to a leaf module (Jun 5) so every
// scheduler job — not just scheduler.ts's architect-inbox caller — shares one
// bearer-aware header builder.
//
// When BODHI's auth boundary is enabled (BODHI_API_AUTH=1 on the server),
// MUTATING /api/* POSTs need `Authorization: Bearer <BODHI_API_TOKEN>`, or they
// 401 silently (the failure class that took 2 days to notice in the off-process
// shell hooks — see pattern_auth_flip_breaks_offprocess_callers_jun05). Send the
// bearer only when the token is set; add no header when unset, so the default
// (no-auth) behavior is unchanged. Mirrors mcp-server/client.ts + the dashboard
// build-time bake. Read per-call so a token rotation is picked up without a
// rebuild (the scheduler runs in-process with the server, which holds the env).
//
// Leaf module: imports nothing from scheduler.ts / jobs/* → no circular import
// (scheduler.ts already imports jobs/system.ts).
// ============================================================
export function internalApiBaseUrl(): string {
  // apps/server binds from PORT; targeting any other env can silently send
  // authenticated scheduler traffic to a different local process.
  const selectedPort = process.env.PORT?.trim() || "3000";
  if (!/^\d+$/.test(selectedPort)) {
    throw new Error("Invalid internal API port configuration");
  }
  const port = Number(selectedPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid internal API port configuration");
  }

  const url = new URL("http://localhost");
  url.port = String(port);
  return url.origin;
}

export function internalApiUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const baseUrl = internalApiBaseUrl();
  return normalizedPath ? new URL(`/${normalizedPath}`, `${baseUrl}/`).toString() : baseUrl;
}

export function internalApiHeaders(): Record<string, string> {
  const token = process.env.BODHI_API_TOKEN;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
