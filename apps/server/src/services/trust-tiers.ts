// ============================================================
// BODHI — Trust Tiers Service
//
// CRUD over the trust_tiers table. The agent consults `getTier()`
// before any action with a known class to decide auto-do / notify
// / await behavior. New action classes get registered via setTier
// once and persist forever.
//
// Phase 6.3 — durable authorization policy, May 15, 2026.
// Root AGENTS.md is the single active authority; this service stores scoped overrides.
// ============================================================

import { getDb, trustTiers, type TrustTier, TRUST_TIERS } from "@seneca/db";
import { eq, asc } from "drizzle-orm";

export interface TrustTierRecord {
  actionClass: string;
  tier: TrustTier;
  setAt: Date;
  note: string | null;
  setBy: string | null;
}

export interface TrustTiersService {
  list: () => Promise<TrustTierRecord[]>;
  getTier: (actionClass: string) => Promise<TrustTier | null>;
  setTier: (input: {
    actionClass: string;
    tier: TrustTier;
    note?: string;
    // Actor attribution (Jul 8) — WHO set this tier. Required so no write path
    // can silently skip attribution ('architect' | 'agent:<id>' | 'probe:<purpose>').
    setBy: string;
  }) => Promise<TrustTierRecord>;
  deleteTier: (actionClass: string) => Promise<boolean>;
}

export function createTrustTiersService(): TrustTiersService {
  const db = getDb();

  async function list(): Promise<TrustTierRecord[]> {
    const rows = await db
      .select()
      .from(trustTiers)
      .orderBy(asc(trustTiers.actionClass));
    return rows.map((r) => ({
      actionClass: r.actionClass,
      tier: r.tier,
      setAt: r.setAt,
      note: r.note,
      setBy: r.setBy,
    }));
  }

  async function getTier(actionClass: string): Promise<TrustTier | null> {
    const rows = await db
      .select({ tier: trustTiers.tier })
      .from(trustTiers)
      .where(eq(trustTiers.actionClass, actionClass))
      .limit(1);
    return rows[0]?.tier ?? null;
  }

  async function setTier(input: {
    actionClass: string;
    tier: TrustTier;
    note?: string;
    setBy: string;
  }): Promise<TrustTierRecord> {
    if (!TRUST_TIERS.includes(input.tier)) {
      throw new Error(
        `invalid tier '${input.tier}' — must be one of: ${TRUST_TIERS.join(", ")}`
      );
    }
    if (!input.actionClass.trim()) {
      throw new Error("actionClass is required");
    }

    const setAt = new Date();
    const setBy = input.setBy ?? null;
    await db
      .insert(trustTiers)
      .values({
        actionClass: input.actionClass,
        tier: input.tier,
        setAt,
        note: input.note ?? null,
        setBy,
      })
      .onConflictDoUpdate({
        target: trustTiers.actionClass,
        set: {
          tier: input.tier,
          setAt,
          note: input.note ?? null,
          setBy,
        },
      });

    console.log(
      `[trust-tiers] ${input.actionClass} → ${input.tier}${
        setBy ? ` (by ${setBy})` : ""
      }${input.note ? ` (${input.note})` : ""}`
    );

    return {
      actionClass: input.actionClass,
      tier: input.tier,
      setAt,
      note: input.note ?? null,
      setBy,
    };
  }

  async function deleteTier(actionClass: string): Promise<boolean> {
    const result = await db
      .delete(trustTiers)
      .where(eq(trustTiers.actionClass, actionClass))
      .returning({ actionClass: trustTiers.actionClass });
    return result.length > 0;
  }

  return { list, getTier, setTier, deleteTier };
}
