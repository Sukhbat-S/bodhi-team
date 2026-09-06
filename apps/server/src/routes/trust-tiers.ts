import type { Hono } from "hono";
import type { TrustTiersService } from "../services/trust-tiers.js";
import type { SystemEventsService } from "../services/system-events.js";

export interface TrustTiersRoutesDeps {
  trustTiersService: TrustTiersService;
  systemEvents: SystemEventsService;
}

/** Trust-tier authorization routes (get/set/delete). Extracted 2026-05-29. */
export function mountTrustTiersRoutes(app: Hono, deps: TrustTiersRoutesDeps): Hono {
  const { trustTiersService, systemEvents } = deps;

  app.get("/api/trust-tiers", async (c) => {
    const tiers = await trustTiersService.list();
    return c.json({
      tiers: tiers.map((t) => ({
        actionClass: t.actionClass,
        tier: t.tier,
        setAt: t.setAt.toISOString(),
        note: t.note,
        setBy: t.setBy,
      })),
    });
  });

  app.post("/api/trust-tiers", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { actionClass, tier, note, setBy } = body as {
      actionClass?: string;
      tier?: string;
      note?: string;
      setBy?: string;
    };
    if (!actionClass || !tier) {
      return c.json({ error: "actionClass and tier are required" }, 400);
    }
    // Resolve the real actor: callers that supply setBy win; human surfaces
    // (dashboard) don't send it → default 'architect'.
    const actor = typeof setBy === "string" && setBy.trim() ? setBy.trim() : "architect";
    try {
      const record = await trustTiersService.setTier({
        actionClass,
        tier: tier as Parameters<typeof trustTiersService.setTier>[0]["tier"],
        note,
        setBy: actor,
      });
      systemEvents
        .record({
          kind: "trust-tier-change",
          severity: "info",
          summary: `${record.actionClass} → ${record.tier} (by ${actor})`,
          payload: { actionClass: record.actionClass, tier: record.tier, note: record.note, setBy: record.setBy },
        })
        .catch(() => {});
      return c.json({
        actionClass: record.actionClass,
        tier: record.tier,
        setAt: record.setAt.toISOString(),
        note: record.note,
        setBy: record.setBy,
      });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "failed to set trust tier" },
        400
      );
    }
  });

  app.delete("/api/trust-tiers/:actionClass", async (c) => {
    const actionClass = c.req.param("actionClass");
    // Actor attribution (Jul 8): DELETE removes the row (no set_by to persist),
    // so the actor is threaded into the emitted event summary only. Accept an
    // optional ?setBy= query param; default 'architect'.
    const rawSetBy = c.req.query("setBy");
    const actor = typeof rawSetBy === "string" && rawSetBy.trim() ? rawSetBy.trim() : "architect";
    const removed = await trustTiersService.deleteTier(actionClass);
    if (!removed) {
      return c.json({ error: `no trust tier for action_class '${actionClass}'` }, 404);
    }
    systemEvents
      .record({
        kind: "trust-tier-delete",
        severity: "info",
        summary: `removed trust tier ${actionClass} (by ${actor})`,
      })
      .catch(() => {});
    return c.json({ removed: actionClass });
  });

  return app;
}
