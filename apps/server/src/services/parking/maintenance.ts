import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import { describeStoredTrigger, parseTrigger } from "./triggers.js";

interface ParkingMaintenanceRow {
  id: string;
  trigger: unknown;
  review_by: string | Date;
}

export interface ParkingMaintenanceReport {
  ok: true;
  deterministic: true;
  observedAt: string;
  scanned: number;
  eligible: number;
  changed: number;
  dateEligible: number;
  reviewEligible: number;
  invalidTriggerCount: number;
  invalidReviewByCount: number;
  descriptiveOnlyCount: number;
  invalidTriggerIds: string[];
  invalidReviewByIds: string[];
  descriptiveOnlyIds: string[];
  resurfaced: Array<{ id: string; reason: string }>;
}

export interface ParkingMaintenanceService {
  reconcile(): Promise<ParkingMaintenanceReport>;
}

function timestamp(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function isoDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Restore the deterministic portion of parking resurfacing without reviving
 * BODHI's retired suggestion/oracle layer. Only two stored boundaries can move
 * a row: a valid date trigger, or review_by for a manual-review trigger.
 * Historical rich conditions remain inert until a person explicitly reviews
 * them; maintenance never reinterprets their generic review deadline.
 */
export function createParkingMaintenanceService(
  db: Database,
  clock: () => Date = () => new Date(),
): ParkingMaintenanceService {
  return {
    async reconcile(): Promise<ParkingMaintenanceReport> {
      const observed = clock();
      const observedMs = observed.getTime();
      if (Number.isNaN(observedMs)) throw new Error("parking maintenance clock is invalid");
      const observedAt = observed.toISOString();

      const rows = (await db.execute(sql`
        SELECT id, trigger, review_by
        FROM parked_items
        WHERE status = 'parked'
        ORDER BY parked_at ASC
      `)) as unknown as ParkingMaintenanceRow[];

      const resurfaced: Array<{ id: string; reason: string }> = [];
      const invalidTriggerIds: string[] = [];
      const invalidReviewByIds: string[] = [];
      const descriptiveOnlyIds: string[] = [];
      let eligible = 0;
      let dateEligible = 0;
      let reviewEligible = 0;

      for (const row of rows) {
        const execution = describeStoredTrigger(row.trigger);
        if (execution.mode === "descriptive-only") {
          descriptiveOnlyIds.push(row.id);
          continue;
        }
        if (execution.mode === "invalid") {
          invalidTriggerIds.push(row.id);
          continue;
        }

        let trigger;
        try {
          trigger = parseTrigger(row.trigger);
        } catch {
          invalidTriggerIds.push(row.id);
          continue;
        }

        let reason: string | null = null;
        if (trigger.type === "date" && observedMs > Date.parse(trigger.on)) {
          reason = `snooze date ${isoDate(trigger.on)} reached`;
          dateEligible += 1;
        } else if (trigger.type === "manual") {
          const reviewAt = timestamp(row.review_by);
          if (Number.isNaN(reviewAt)) {
            invalidReviewByIds.push(row.id);
            continue;
          }
          if (observedMs > reviewAt) {
            reason = "manual review due";
            reviewEligible += 1;
          }
        }

        if (!reason) continue;
        eligible += 1;

        // The status predicate makes concurrent/manual runs idempotent. Count
        // only the row this run actually transitioned.
        const updated = (await db.execute(sql`
          UPDATE parked_items
          SET status = 'resurfaced',
              resurfaced_at = ${observedAt}::timestamptz,
              resurfaced_reason = ${reason}
          WHERE id = ${row.id}
            AND status = 'parked'
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length > 0) resurfaced.push({ id: row.id, reason });
      }

      return {
        ok: true,
        deterministic: true,
        observedAt,
        scanned: rows.length,
        eligible,
        changed: resurfaced.length,
        dateEligible,
        reviewEligible,
        invalidTriggerCount: invalidTriggerIds.length,
        invalidReviewByCount: invalidReviewByIds.length,
        descriptiveOnlyCount: descriptiveOnlyIds.length,
        invalidTriggerIds,
        invalidReviewByIds,
        descriptiveOnlyIds,
        resurfaced,
      };
    },
  };
}
