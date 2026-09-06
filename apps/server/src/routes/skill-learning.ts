import type { Context, Hono, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { rateLimit } from "../middleware/rate-limit.js";
import {
  SkillLearningConflictError,
  SkillLearningNotFoundError,
  SkillLearningValidationError,
  type RecordSkillRunInput,
  type SkillCandidateResolution,
  type SkillLearningService,
} from "../services/skill-learning.js";
import type { SkillCandidateStatus, SkillChangeType, SkillSignalSeverity } from "@seneca/db";

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SkillLearningValidationError("request body must be an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SkillLearningValidationError) throw error;
    throw new SkillLearningValidationError("invalid JSON body");
  }
}

function skillLearningError(c: Context, error: unknown): Response {
  if (error instanceof SkillLearningValidationError) return c.json({ error: error.message }, 400);
  if (error instanceof SkillLearningNotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof SkillLearningConflictError) return c.json({ error: error.message }, 409);
  throw error;
}

export function mountSkillLearningRoutes(app: Hono, service: SkillLearningService): Hono {
  const mutationLimit = rateLimit("checkpoints");
  const payloadLimit = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: "skill learning body exceeds 64 KiB" }, 413),
  });
  const limitMutations = async (c: Context, next: Next) => {
    if (c.req.method !== "POST") return next();
    return mutationLimit(c, next);
  };
  const limitBodies = async (c: Context, next: Next) => {
    if (c.req.method !== "POST") return next();
    return payloadLimit(c, next);
  };
  app.use("/api/skill-learning/*", limitMutations, limitBodies);

  app.post("/api/skill-learning/runs", async (c) => {
    try {
      return c.json(await service.recordSkillRun(await jsonBody(c) as RecordSkillRunInput), 200);
    } catch (error) {
      return skillLearningError(c, error);
    }
  });

  app.get("/api/skill-learning/usage", async (c) => {
    try {
      const usage = await service.listSkillUsage({
        project: c.req.query("project"),
        skill: c.req.query("skill"),
        version: c.req.query("version"),
        since: c.req.query("since"),
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      });
      return c.json({
        usage,
        telemetry: {
          observedThrough: new Date().toISOString(),
          coverage: usage.length ? "observed" : "unverified",
        },
      });
    } catch (error) {
      return skillLearningError(c, error);
    }
  });

  app.get("/api/skill-learning/candidates", async (c) => {
    try {
      const candidates = await service.listCandidates({
        project: c.req.query("project"),
        skill: c.req.query("skill"),
        type: c.req.query("type") as SkillChangeType | undefined,
        severity: c.req.query("severity") as SkillSignalSeverity | undefined,
        status: c.req.query("status") as SkillCandidateStatus | undefined,
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      });
      return c.json({ candidates });
    } catch (error) {
      return skillLearningError(c, error);
    }
  });

  app.post("/api/skill-learning/candidates/:id/resolve", async (c) => {
    try {
      const candidate = await service.resolveCandidate(
        c.req.param("id"),
        await jsonBody(c) as SkillCandidateResolution,
      );
      return c.json({ candidate });
    } catch (error) {
      return skillLearningError(c, error);
    }
  });

  app.post("/api/skill-learning/maintenance/compact", async (c) => {
    try {
      return c.json(await service.compact(await jsonBody(c) as never));
    } catch (error) {
      return skillLearningError(c, error);
    }
  });

  return app;
}
