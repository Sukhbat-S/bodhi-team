import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { policyPacketSchema } from "@seneca/core";
import type { Database } from "@seneca/db";
import { sanitizeMemoryContent, type MemoryService } from "@seneca/memory";
import { createTrustTiersService } from "../services/trust-tiers.js";
import type { AuditService } from "../lib/audit.js";

let libraryDomainsCache: { domains: string[]; cachedAt: number } | null = null;
const LIBRARY_DOMAINS_TTL_MS = 60_000;
const RETIRED_ACTION_CLASS = /(?:^|_)(?:claude|subagent)(?:_|$)/i;
const RETIRED_EXACT_ACTION_CLASSES = new Set([
  "run_code_task",
  "update_claude_md",
]);
const MAIN_PUSH_ACTION_CLASSES = new Set([
  "push_commit_main",
  "push_commit_main_bodhi",
  "push_commit_main_bodhi_verified",
  "push_commit_main_jewelry_docs",
  "push_commit_main_jewelry_verified",
]);
const RETIRED_EXECUTION_CONTEXT = /\b(?:bodhi-(?:impl|scout|crit|security|ui|watch|learn)|subagent|claude|max 5×|luna|terra|sol\/medium)\b/i;

type PolicyTrustTier = { actionClass: string; tier: "auto-do" | "notify" | "await" };

/**
 * Return mutually exclusive main-push policy for the requested project.
 *
 * The database retains durable source rows, including a conservative generic
 * fallback. Emitting that fallback beside a more-specific project rule made
 * callers choose between contradictory-looking rows after the explanatory
 * notes had been stripped. Resolve that scope here instead.
 */
export function resolveTrustTiersForProject(
  tiers: readonly PolicyTrustTier[],
  project: string,
  cwd: string,
): PolicyTrustTier[] {
  const active = tiers.filter((tier) =>
    !RETIRED_ACTION_CLASS.test(tier.actionClass)
    && !RETIRED_EXACT_ACTION_CLASSES.has(tier.actionClass),
  );
  const byClass = new Map(active.map((tier) => [tier.actionClass, tier]));
  const resolved = active.filter((tier) => !MAIN_PUSH_ACTION_CLASSES.has(tier.actionClass));
  const identity = `${project} ${cwd}`.toLowerCase();
  const isJewelry = /jewelry|retail/.test(identity);
  const isBodhi = /(?:^|[\s/._-])bodhi(?:$|[\s/._-])/.test(identity);

  if (isJewelry) {
    const docs = byClass.get("push_commit_main_jewelry_docs");
    const verified = byClass.get("push_commit_main_jewelry_verified");
    const fallback = byClass.get("push_commit_main");
    if (docs) resolved.push(docs);
    if (verified) resolved.push(verified);
    if (fallback) {
      resolved.push({
        actionClass: "push_commit_main_jewelry_unverified",
        tier: fallback.tier,
      });
    }
  } else if (isBodhi) {
    const bodhi = byClass.get("push_commit_main_bodhi_verified")
      ?? byClass.get("push_commit_main_bodhi");
    if (bodhi) resolved.push(bodhi);
  } else {
    const fallback = byClass.get("push_commit_main");
    if (fallback) {
      resolved.push({ actionClass: "push_commit_main_unknown", tier: fallback.tier });
    }
  }

  return resolved.sort((left, right) => left.actionClass.localeCompare(right.actionClass));
}

async function getLibraryDomains(db: Database): Promise<string[]> {
  const now = Date.now();
  if (libraryDomainsCache && now - libraryDomainsCache.cachedAt < LIBRARY_DOMAINS_TTL_MS) {
    return libraryDomainsCache.domains;
  }
  try {
    const rows = await db.execute(sql`SELECT DISTINCT domain FROM library_entries ORDER BY domain`);
    const domains = (rows as unknown as Array<{ domain: string }>).map((row) => row.domain).filter(Boolean);
    libraryDomainsCache = { domains, cachedAt: now };
    return domains;
  } catch {
    return libraryDomainsCache?.domains ?? [];
  }
}

export interface PolicyPacketRoutesDeps {
  db: Database;
  trustTiersService: ReturnType<typeof createTrustTiersService>;
  memoryService: MemoryService;
  audit: AuditService;
}

/**
 * Provider-neutral policy context for the current Codex task.
 *
 * This endpoint does not know about specialist personas or dispatch history.
 * It exposes only durable user state, trust boundaries, reviewed memories, and
 * discoverable library domains. The native task decides how to use them.
 */
export function mountPolicyPacketRoutes(app: Hono, deps: PolicyPacketRoutesDeps): Hono {
  const { db, trustTiersService, memoryService, audit } = deps;

  app.get("/api/policy-packet", async (c) => {
    const project = (c.req.query("project") ?? "bodhi").slice(0, 64);
    const cwd = (c.req.query("cwd") ?? "").slice(0, 256);

    const [tiers, preferences, decisions, libraryDomains] = await Promise.all([
      trustTiersService.list(),
      memoryService.listFiltered({ type: "preference", status: "confirmed", limit: 8 }),
      memoryService.listFiltered({ type: "decision", status: "confirmed", limit: 6 }),
      getLibraryDomains(db),
    ]);

    const reviewedContext = [...preferences.memories, ...decisions.memories]
      .filter((memory) =>
        !memory.tags?.some((tag) => tag === "model-routing" || tag === "quota")
        && !RETIRED_EXECUTION_CONTEXT.test(memory.content),
      )
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 10)
      .map((memory) => {
        const { content } = sanitizeMemoryContent(
          memory.content.slice(0, 280),
          `policy-packet.recentFeedback:${memory.id}`,
          audit,
        );
        return {
          id: memory.id,
          type: memory.type,
          content,
          tags: memory.tags ?? [],
          createdAt: new Date(memory.createdAt).toISOString(),
        };
      });

    const packet = policyPacketSchema.parse({
      contractVersion: 3,
      trustTiers: resolveTrustTiersForProject(tiers, project, cwd),
      reviewedContext,
      libraryDomains,
      evidenceOrder: [
        "Repository code and emitted runtime signals",
        "Targeted search and bounded file reads",
        "Confirmed BODHI memories when personal context is relevant",
        "Library retrieval only when explicitly useful and corroborated",
      ],
      project,
      cwd,
      generatedAt: new Date().toISOString(),
    });
    return c.json(packet);
  });

  return app;
}
