import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SystemEventsService } from "../services/system-events.js";
import { badUuid } from "../lib/validation.js";

export interface SystemEventsRoutesDeps {
  systemEvents: SystemEventsService;
}

/**
 * System-events timeline endpoints (closure-tracking — Apr 26 C#5).
 * Extracted from apps/server/src/index.ts on 2026-05-29 (Wave B
 * composition-root completion). 3 routes: recent list, live SSE stream, ack.
 * Closure state: systemEvents (injected via deps).
 */
export function mountSystemEventsRoutes(app: Hono, deps: SystemEventsRoutesDeps): Hono {
  const { systemEvents } = deps;

  app.get("/api/events/recent", async (c) => {
    const hours = Number(c.req.query("hours") ?? 24);
    const kind = c.req.query("kind") ?? undefined;
    const limit = Number(c.req.query("limit") ?? 200);
    const unackedOnly = c.req.query("unacked") === "1";
    const events = await systemEvents.listRecent({ hours, kind, limit, unackedOnly });
    return c.json({ events });
  });

  // Phase 2: live event stream — BrainHome subscribes to pulse
  // matching organ nodes in the agent graph.
  app.get("/api/events/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const onEvent = async (event: Record<string, unknown>) => {
        try { await stream.writeSSE({ event: "event", data: JSON.stringify(event) }); } catch { /* disconnected */ }
      };
      systemEvents.bus.on("event", onEvent);

      const heartbeat = setInterval(async () => {
        try { await stream.writeSSE({ event: "heartbeat", data: "" }); } catch { clearInterval(heartbeat); }
      }, 30_000);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          systemEvents.bus.off("event", onEvent);
          clearInterval(heartbeat);
          resolve();
        });
      });
    });
  });

  app.post("/api/events/:id/ack", async (c) => {
    const id = c.req.param("id");
    const bad = badUuid(c, id); if (bad) return bad;
    const ok = await systemEvents.acknowledge(id);
    return c.json({ acknowledged: ok });
  });

  return app;
}
