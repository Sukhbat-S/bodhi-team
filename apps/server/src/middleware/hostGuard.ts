import type { Context, Next } from "hono";

export interface HostGuardOptions { port?: number; }
function allowedHosts(options: HostGuardOptions): Set<string> {
  const port = String(options.port ?? process.env.PORT?.trim() ?? "3000");
  const hosts = new Set(["127.0.0.1", "localhost", "[::1]", "[::ffff:127.0.0.1]"]);
  for (const host of [...hosts]) hosts.add(`${host}:${port}`);
  const configured = process.env.BODHI_ALLOWED_HOST?.trim().toLowerCase();
  if (configured) hosts.add(configured);
  return hosts;
}

/** Guard the whole document/asset/API boundary, before CORS can answer. */
export function hostGuard(options: HostGuardOptions = {}) {
  return async (c: Context, next: Next) => {
    // Only the minimal non-sensitive health probe is intentionally public.
    // Status, smoke diagnostics, retired routes and credential-bearing assets
    // must not bypass Host validation.
    if (c.req.path === "/health") { await next(); return; }
    const host = (c.req.header("Host") ?? "").trim().toLowerCase();
    if (!allowedHosts(options).has(host)) return c.json({ error: "forbidden", detail: "host not allowed" }, 403);
    const site = c.req.header("Sec-Fetch-Site");
    const mode = c.req.header("Sec-Fetch-Mode");
    if (site === "cross-site" && mode !== "navigate") return c.json({ error: "forbidden", detail: "cross-site request rejected" }, 403);
    await next();
  };
}
