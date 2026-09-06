import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "./middleware/rate-limit.js";
import { apiAuth, isApiAuthEnabled } from "./middleware/apiAuth.js";
import { hostGuard } from "./middleware/hostGuard.js";
import { mountLibraryRoutes } from "./routes/library.js";
import { mountEntitiesRoutes } from "./routes/entities.js";
import { mountHealthRoutes } from "./routes/health.js";
import { mountSystemEventsRetainRoutes } from "./routes/system-events-retain.js";
import { mountTrustTiersRoutes } from "./routes/trust-tiers.js";
import { mountMemoryRoutes } from "./routes/memory.js";
import { mountParkingRoutes } from "./routes/parking.js";
import { mountMaintenanceLivenessRoutes } from "./routes/maintenance-liveness.js";
import { mountAuditRoutes } from "./routes/audit.js";
import { mountSchedulerRoutes } from "./routes/scheduler.js";
import { mountSystemEventsRoutes } from "./routes/system-events.js";
import { mountPolicyPacketRoutes } from "./routes/policy-packet.js";
import { mountStatusRoutes } from "./routes/status.js";
import { mountCheckpointRoutes } from "./routes/checkpoints.js";
import { createCheckpointService } from "./services/checkpoints.js";
import { mountPersonalDirectionRoutes } from "./routes/personal-direction.js";
import { createPersonalDirectionService } from "./services/personal-direction.js";
import { mountSkillLearningRoutes } from "./routes/skill-learning.js";
import { createSkillLearningService } from "./services/skill-learning.js";
import { mountLegacyCompatibilityRoutes } from "./routes/legacy-compatibility.js";
import type { Runtime } from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOptions {
  dashboardDistPath?: string;
  onCompose?: (key: "cors" | "host-guard" | "api-auth" | "routes" | "api-404" | "spa") => void;
}

export function createApp(runtime: Runtime, options: CreateAppOptions = {}) {
  const {
    config, db, systemEvents,
    trustTiersService, audit, memoryService, entityService,
    insightGenerator, libraryService, scheduler,
  } = runtime;
  // 10. Set up Hono API server
  const app = new Hono();

  const dashboardDistPath = options.dashboardDistPath ?? path.resolve(__dirname, "../../../apps/dashboard/dist");
  const hasDashboard = fs.existsSync(dashboardDistPath);

  app.use("/*", hostGuard({ port: config.PORT }));
  options.onCompose?.("host-guard");

  // CORS for dashboard (Vite dev on port 5173 + optional remote origins + PWA domain)
  const corsOrigins = ["http://localhost:5173", `http://localhost:${config.PORT}`];
  if (config.PUBLIC_URL) {
    corsOrigins.push(config.PUBLIC_URL);
  }
  if (config.CORS_ORIGINS) {
    corsOrigins.push(...config.CORS_ORIGINS.split(",").map((o) => o.trim()));
  }
  app.use("/*", cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-BODHI-Origin", "X-BODHI-Tool"],
  }));
  options.onCompose?.("cors");

  // Phase 2: detect MCP-originated requests and emit mcp_call. The MCP
  // server attaches X-BODHI-Origin: mcp on every fetch — middleware
  // emits a single event per call so BrainHome can pulse the MCP node.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("X-BODHI-Origin");
    if (origin === "mcp") {
      const startMs = Date.now();
      await next();
      systemEvents.record({
        kind: "mcp_call",
        summary: `mcp → ${c.req.method} ${c.req.path}`,
        // Wave D (Jun 10): `tool` = the MCP tool name set by the mcp-server's
        // registerTool wrapper (X-BODHI-Tool header) — null for older clients.
        payload: { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - startMs, tool: c.req.header("X-BODHI-Tool") ?? null },
        severity: c.res.status >= 400 ? "warn" : "info",
      }).catch(() => { /* best-effort */ });
      return;
    }
    await next();
  });

  // C1 (Jun 3): bearer-token auth boundary on mutating /api/*. DEFAULT OFF —
  // a pure pass-through unless BODHI_API_AUTH=1, so back-compat is total when
  // the flag is unset. When enabled, POST/PUT/PATCH/DELETE under /api/* require
  // `Authorization: Bearer <BODHI_API_TOKEN>` (constant-time compare) → 401 on
  // missing/mismatch; GET stays open; /api/status is exempt. Mounted before the
  // rate-limiter so an unauthorized flood is rejected at the cheapest point.
  // See middleware/apiAuth.ts for the enable steps + exemption rationale.
  //
  // Host validation already covers every surface before CORS above.
  // Jul 26: emit on rejection. SECURITY.md §0.1 item 4 asked whether 401s leave
  // a trace; verified today that they did not, so the boundary could be probed
  // silently. severity=warn so it surfaces in /api/events/recent (the dashboard's
  // events feed) rather than only existing in a table nothing reads. The token is
  // never passed to the hook — only method, path, reason, and whether a header
  // was present at all, which is what distinguishes a probe from a stale client.
  app.use(
    "/api/*",
    apiAuth({
      onReject: (info) => {
        systemEvents
          .record({
            kind: "auth-reject",
            summary: `401 ${info.method} ${info.path} — ${info.reason}`,
            payload: { ...info },
            severity: "warn",
          })
          .catch(() => { /* best-effort */ });
      },
    }),
  );
  options.onCompose?.("api-auth");

  // Boot self-check (Jun 5): surface the boundary state at startup so a misfire
  // (auth on but token missing, or a stale dashboard bundle) is visible AT BOOT
  // instead of discovered days later via silent 401s — the failure class behind
  // pattern_auth_flip_breaks_offprocess_callers_jun05.
  if (isApiAuthEnabled()) {
    const tokenOk = (process.env.BODHI_API_TOKEN ?? "").length > 0;
    console.log(
      "  Auth boundary: ENGAGED (mutating /api/* requires bearer)" +
        (tokenOk ? "" : "  ⚠ BODHI_API_TOKEN EMPTY — every mutating request 401s (fail-closed)"),
    );
    if (tokenOk) {
      console.log(
        "  ↳ authenticated MCP/operator callers retain write authority; the console is read-only",
      );
    }
  } else {
    console.log("  Auth boundary: off (BODHI_API_AUTH unset — single-user loopback default)");
  }

  // C7a (Jun 3): rate-limit the substrate-mutating write endpoints. Gated to
  // POST only so reads/SSE on the same paths (GET /api/sessions/messages,
  // GET/DELETE /api/memories/:id) are never throttled. Limits are generous
  // (single-user, loopback); a machine-paced flood trips 429, a human/orch
  // batch does not. See middleware/rate-limit.ts (RATE_LIMITS constants).
  const limitMemories = rateLimit("memories");
  app.use("/api/memories", async (c, next) => {
    if (c.req.method === "POST") return limitMemories(c, next);
    await next();
  });
  app.use("/api/memories/batch", async (c, next) => {
    if (c.req.method === "POST") return limitMemories(c, next);
    await next();
  });
  // #11 resource-exhaustion (Jun 4): the embedding-bearing GET search routes
  // each fire a PAID Voyage embedding call per cache-miss; a varied ?q= loop
  // is an uncapped cost vector. Bucket them REGARDLESS of method (the cost is
  // on GET, not a mutation) — this is additive: it does not reorder or alter
  // the write buckets above. See middleware/rate-limit.ts ("search-embed").
  const limitSearchEmbed = rateLimit("search-embed");
  app.use("/api/memories/search", limitSearchEmbed);
  app.use("/api/library/search", limitSearchEmbed);

  // Global error handler — return JSON errors instead of HTML
  app.onError((err, c) => {
    // A malformed JSON request body throws a SyntaxError out of c.req.json() —
    // that's a client error, not a server fault: 400, not 500. Surface it before
    // the generic handler (and skip the server-side console.error for it).
    if (err instanceof SyntaxError) {
      return c.json({ error: "Malformed JSON in request body" }, 400);
    }
    console.error(`[api] ${c.req.method} ${c.req.path} error:`, err.message);
    // Don't leak internal error details to clients
    return c.json({ error: "Internal server error" }, 500);
  });

  // Root: serve dashboard when built, else JSON health check
  if (!hasDashboard) {
    app.get("/", (c) => {
      return c.json({
        name: "BODHI",
        status: "online",
        version: "1.0.0",
        uptime: process.uptime(),
        reasoning: "native-codex",
        memory: true,
      });
    });
  }

  mountHealthRoutes(app, { db, memoryService });

  // Durable substrate surfaces. No route below may invoke a model.
  mountSystemEventsRetainRoutes(app, { db, systemEvents });
  mountLibraryRoutes(app, { libraryService, db });
  mountParkingRoutes(app, { db });
  mountCheckpointRoutes(app, { checkpointService: createCheckpointService(db) });
  mountPersonalDirectionRoutes(app, createPersonalDirectionService(db));
  mountSkillLearningRoutes(app, createSkillLearningService(db));
  // Compatibility release: old orchestration endpoints remain discoverable but
  // cannot read or write legacy operational state. Every method returns 410 with
  // a native Codex/checkpoint replacement pointer.
  mountLegacyCompatibilityRoutes(app);
  mountMaintenanceLivenessRoutes(app, { db, systemEvents });
  mountAuditRoutes(app, { audit });
  mountMemoryRoutes(app, {
    timeZone: config.TIMEZONE,
    db,
    memoryService,
    insightGenerator,
    entityService,
    audit,
    systemEvents,
  });
  mountEntitiesRoutes(app, { entityService, db });
  mountSchedulerRoutes(app, { db, scheduler, audit });
  mountTrustTiersRoutes(app, { trustTiersService, systemEvents });
  mountPolicyPacketRoutes(app, { db, trustTiersService, memoryService, audit });
  mountSystemEventsRoutes(app, { systemEvents });
  mountStatusRoutes(app, { scheduler, db, config });
  options.onCompose?.("routes");

  // Unknown /api/* → 404 JSON. Placed AFTER every real mountXxxRoutes() above so
  // it can only catch routes that no mount claimed — and BEFORE the SPA `*`
  // catch-all below, which would otherwise serve index.html (200) for a bad API
  // path. Lives outside the hasDashboard block so the JSON-404 holds in dev too.
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  options.onCompose?.("api-404");

  // === Static Dashboard Serving ===
  if (hasDashboard) {
    console.log(`  Dashboard: serving static build from ${dashboardDistPath}`);

    // serveStatic root is relative to CWD; when started via workspace,
    // CWD = apps/server/ — use relative path to dashboard dist
    const staticRoot = path.relative(process.cwd(), dashboardDistPath);

    app.use(
      "/assets/*",
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, immutable, max-age=31536000");
        },
      })
    );

    // PWA: manifest, icons, service worker
    app.use(
      "/icons/*",
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, max-age=86400");
        },
      })
    );
    app.use(
      "/manifest.json",
      serveStatic({ root: staticRoot })
    );
    app.use(
      "/sw.js",
      serveStatic({
        root: staticRoot,
        onFound: (_path, c) => {
          c.header("Cache-Control", "no-cache");
          c.header("Service-Worker-Allowed", "/");
        },
      })
    );
    app.use(
      "/registerSW.js",
      serveStatic({ root: staticRoot })
    );


    // SPA fallback: serve index.html for any non-API, non-asset route.
    // Cached at mount (May 29) — index.html is a static build artifact, so a
    // per-request synchronous fs.readFileSync needlessly blocked the event loop
    // on every navigation.
    //
    // G2 #4 — STALE-CACHE FIX: a standalone `npm run build -w @seneca/dashboard`
    // (rebuild without restarting the server) emits a NEW index.html pointing at
    // new hashed chunks AND deletes the old ones. The module-eval cache kept
    // serving the OLD index → its <script src> pointed at deleted chunks → blank
    // page, no error. Stat-cache it: remember mtimeMs and re-read only when the
    // file changes (cheap statSync per request, full read only on rebuild).
    const indexPath = path.join(dashboardDistPath, "index.html");
    let cachedIndexHtml = fs.readFileSync(indexPath, "utf-8");
    let cachedIndexMtime = fs.statSync(indexPath).mtimeMs;
    app.get("*", (c) => {
      try {
        const mtime = fs.statSync(indexPath).mtimeMs;
        if (mtime !== cachedIndexMtime) {
          cachedIndexHtml = fs.readFileSync(indexPath, "utf-8");
          cachedIndexMtime = mtime;
        }
      } catch { /* file vanished mid-rebuild — serve last good copy */ }
      return c.html(cachedIndexHtml);
    });
    options.onCompose?.("spa");
  } else {
    console.log("  Dashboard: no static build found (dev mode — use Vite on :5173)");
  }

  return app;
}
