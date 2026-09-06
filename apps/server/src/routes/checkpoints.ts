// ============================================================
// BODHI 1.0 — authenticated checkpoint HTTP surface
//
// Authentication is supplied by create-app's global /api/* bearer boundary.
// These handlers therefore contain only contract validation and service error
// translation; they do not invent a second auth mechanism.
// ============================================================

import type { Context, Hono, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { rateLimit } from "../middleware/rate-limit.js";
import {
  CheckpointConflictError,
  CheckpointAmbiguityError,
  CheckpointNotFoundError,
  CheckpointValidationError,
  type AttachArtifactInput,
  type CheckpointService,
  type CompleteCheckpointInput,
  type RecordVerificationInput,
  type SaveCheckpointInput,
} from "../services/checkpoints.js";
import type { CheckpointState } from "@seneca/db";

export interface CheckpointRoutesDeps {
  checkpointService: CheckpointService;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new CheckpointValidationError("invalid JSON body");
  }
}

function checkpointError(c: Context, error: unknown): Response {
  if (error instanceof CheckpointValidationError) return c.json({ error: error.message }, 400);
  if (error instanceof CheckpointNotFoundError) return c.json({ error: error.message }, 404);
  if (error instanceof CheckpointAmbiguityError) return c.json({ error: error.message, code: error.code, candidates: error.candidates }, 409);
  if (error instanceof CheckpointConflictError) return c.json({ error: error.message }, 409);
  if ((error as { code?: string })?.code === "23503") return c.json({ error: "checkpoint not found" }, 404);
  throw error;
}

export function mountCheckpointRoutes(app: Hono, deps: CheckpointRoutesDeps): Hono {
  const service = deps.checkpointService;
  const checkpointBodyLimit = bodyLimit({
    maxSize: 512 * 1024,
    onError: (c) => c.json({ error: "checkpoint body exceeds 512 KiB" }, 413),
  });
  const checkpointRateLimit = rateLimit("checkpoints");
  const rateLimitMutation = async (c: Context, next: Next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
    return checkpointRateLimit(c, next);
  };
  const limitMutationBody = async (c: Context, next: Next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
    return checkpointBodyLimit(c, next);
  };
  app.use("/api/checkpoints", rateLimitMutation, limitMutationBody);
  app.use("/api/checkpoints/*", rateLimitMutation, limitMutationBody);

  app.post("/api/checkpoints", async (c) => {
    try {
      const checkpoint = await service.save(await jsonBody(c) as SaveCheckpointInput);
      return c.json({ checkpoint }, 200);
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  app.get("/api/checkpoints", async (c) => {
    try {
      const checkpoints = await service.find({
        project: c.req.query("project"),
        state: c.req.query("state") as CheckpointState | undefined,
        objective: c.req.query("objective"),
        entity: c.req.query("entity"),
        provider: c.req.query("provider"),
        providerTaskId: c.req.query("providerTaskId"),
        since: c.req.query("since"),
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      });
      return c.json({ checkpoints });
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  // Exact path is intentionally mounted before /:id.
  app.post("/api/checkpoints/maintenance/reconcile", async (c) => {
    try {
      return c.json(await service.reconcileMaintenance());
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  app.get("/api/checkpoints/:id", async (c) => {
    try {
      const provider = c.req.query("provider");
      const checkpoint = provider
        ? await service.getByProvider(provider, c.req.param("id"), c.req.query("project"), c.req.query("selection") as "current" | undefined)
        : await service.get(c.req.param("id"));
      if (!checkpoint) return c.json({ error: "checkpoint not found" }, 404);
      return c.json({ checkpoint });
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  app.post("/api/checkpoints/:id/artifacts", async (c) => {
    try {
      const artifact = await service.attachArtifact(
        c.req.param("id"),
        await jsonBody(c) as AttachArtifactInput,
      );
      return c.json({ artifact }, 201);
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  app.post("/api/checkpoints/:id/verifications", async (c) => {
    try {
      const verificationReceipt = await service.recordVerification(
        c.req.param("id"),
        await jsonBody(c) as RecordVerificationInput,
      );
      return c.json({ verificationReceipt }, 201);
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  app.post("/api/checkpoints/:id/complete", async (c) => {
    try {
      const checkpoint = await service.complete(
        c.req.param("id"),
        await jsonBody(c) as CompleteCheckpointInput,
      );
      return c.json({ checkpoint });
    } catch (error) {
      return checkpointError(c, error);
    }
  });

  return app;
}
