import type { Hono } from "hono";
import type { AuditService } from "../lib/audit.js";

export interface AuditRoutesDeps {
  audit: AuditService;
}

export function mountAuditRoutes(app: Hono, deps: AuditRoutesDeps): Hono {
  const { audit } = deps;

  app.get("/api/audit", async (c) => {
    const kind = c.req.query("kind");
    const actor = c.req.query("actor");
    const days = c.req.query("days") ? Number(c.req.query("days")) : undefined;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
    const rows = await audit.query({ kind, actor, days, limit });
    return c.json({ entries: rows });
  });

  return app;
}
