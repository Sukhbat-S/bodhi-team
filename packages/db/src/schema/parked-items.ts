// packages/db/src/schema/parked-items.ts
import { pgTable, text, timestamp, jsonb, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export type ParkedOriginKind = "memory" | "cron" | "dispatch" | "inbox" | "free";
export type ParkedStatus = "parked" | "resurfaced" | "closed";
// NOTE: 'expired_review' is RESERVED, not yet written by any code path —
// review_by expiry RESURFACES an item (evaluator.ts), it never auto-closes.
// The value exists so a future manual "reviewed, still not worth doing" close
// can be distinguished without a constraint migration.
export type ParkedClosedReason = "done" | "moot" | "expired_review";

export const parkedItems = pgTable(
  "parked_items",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    originKind: text("origin_kind").$type<ParkedOriginKind>().notNull().default("free"),
    originRef: text("origin_ref"),
    trigger: jsonb("trigger").notNull(),
    autoClose: jsonb("auto_close"),
    reviewBy: timestamp("review_by", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    status: text("status").$type<ParkedStatus>().notNull().default("parked"),
    closedReason: text("closed_reason").$type<ParkedClosedReason>(),
    resurfacedReason: text("resurfaced_reason"),
    parkedAt: timestamp("parked_at", { withTimezone: true }).notNull().defaultNow(),
    resurfacedAt: timestamp("resurfaced_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    surfacedCloseAt: timestamp("surfaced_close_at", { withTimezone: true }),
    createdBy: text("created_by"),
  },
  (t) => ({
    statusChk: check("parked_items_status_chk", sql`${t.status} IN ('parked','resurfaced','closed')`),
    originChk: check("parked_items_origin_chk", sql`${t.originKind} IN ('memory','cron','dispatch','inbox','free')`),
    closedReasonChk: check(
      "parked_items_closed_reason_chk",
      sql`${t.closedReason} IS NULL OR ${t.closedReason} IN ('done','moot','expired_review')`,
    ),
    statusIdx: index("parked_items_status_idx").on(t.status),
    originIdx: index("parked_items_origin_idx").on(t.originKind, t.originRef),
  }),
);

export type ParkedItem = InferSelectModel<typeof parkedItems>;
export type NewParkedItem = InferInsertModel<typeof parkedItems>;
