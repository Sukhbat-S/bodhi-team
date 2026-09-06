import type { Context, Hono } from "hono";
import {
  DirectionConflictError,
  DirectionNotFoundError,
  DirectionValidationError,
  type PersonalDirectionService,
} from "../services/personal-direction.js";

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    throw new DirectionValidationError("invalid JSON body");
  }
}

function directionError(c: Context, error: unknown): Response {
  if (error instanceof DirectionValidationError) return c.json({ error: error.message }, 400);
  if (error instanceof DirectionNotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof DirectionConflictError) return c.json({ error: error.message }, 409);
  throw error;
}

export function mountPersonalDirectionRoutes(app: Hono, service: PersonalDirectionService): Hono {
  app.post("/api/goals", async (c) => {
    try { return c.json({ goal: await service.createGoal(await body(c) as never) }, 201); }
    catch (error) { return directionError(c, error); }
  });
  app.patch("/api/goals/:id", async (c) => {
    try { return c.json({ goal: await service.updateGoal(c.req.param("id"), await body(c) as never) }); }
    catch (error) { return directionError(c, error); }
  });
  app.get("/api/goals", async (c) => {
    try {
      const page = await service.listGoalPage({
        project: c.req.query("project"), status: c.req.query("status") as never,
        reviewDue: c.req.query("reviewDue") as never, goalId: c.req.query("goalId"),
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      });
      return c.json(page);
    } catch (error) { return directionError(c, error); }
  });
  app.post("/api/goals/:id/reviews", async (c) => {
    try { return c.json({ review: await service.recordGoalReview(c.req.param("id"), await body(c) as never) }, 201); }
    catch (error) { return directionError(c, error); }
  });

  app.post("/api/opportunities", async (c) => {
    try {
      const result = await service.proposeOpportunity(await body(c) as never);
      return c.json(result, result.deduped ? 200 : 201);
    } catch (error) { return directionError(c, error); }
  });
  app.get("/api/opportunities", async (c) => {
    try {
      const opportunities = await service.listOpportunities({
        project: c.req.query("project"), status: c.req.query("status") as never,
        goalId: c.req.query("goalId"), limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      });
      return c.json({ opportunities });
    } catch (error) { return directionError(c, error); }
  });
  app.post("/api/opportunities/:id/resolve", async (c) => {
    try { return c.json({ opportunity: await service.resolveOpportunity(c.req.param("id"), await body(c) as never) }); }
    catch (error) { return directionError(c, error); }
  });

  app.get("/api/workflow-candidates", async (c) => {
    try {
      const candidates = await service.listWorkflowCandidates({
        project: c.req.query("project"), status: c.req.query("status") as never,
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      });
      return c.json({ candidates });
    } catch (error) { return directionError(c, error); }
  });
  app.post("/api/workflow-candidates/:id/resolve", async (c) => {
    try { return c.json({ candidate: await service.resolveWorkflowCandidate(c.req.param("id"), await body(c) as never) }); }
    catch (error) { return directionError(c, error); }
  });

  return app;
}
