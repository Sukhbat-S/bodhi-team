import type { Hono } from "hono";
import type { Database } from "@seneca/db";
import type { loadConfig } from "../config.js";
import { computeArmLiveness } from "./maintenance-liveness.js";
import type { SchedulerRouteScheduler } from "./scheduler.js";
import { buildStatusSnapshot } from "../services/status.js";

export interface StatusRoutesDeps {
  scheduler: Pick<SchedulerRouteScheduler, "getStatus">;
  config: ReturnType<typeof loadConfig>;
  db: Database;
}

export function mountStatusRoutes(app: Hono, deps: StatusRoutesDeps): Hono {
  const { scheduler, config, db } = deps;

  app.get("/api/status", async (c) => {
    const schedulerDetail = scheduler.getStatus();
    return c.json(await buildStatusSnapshot({
      schedulerDetail,
      ownerName: config.BODHI_OWNER_NAME,
      readMaintenanceLiveness: () => computeArmLiveness(db),
    }));
  });

  return app;
}
