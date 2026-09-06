// ============================================================
// BODHI — System Events Schema (Drizzle ORM)
// Single closure-tracking surface: every detection signal
// (synthesis, drift, briefing, workflow, watcher, intel) lands
// here. Powers the /dashboard/recent timeline. Replaces the
// 5-surface "what happened in 24h?" puzzle (Apr 26 audit C#5).
// ============================================================

import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const systemEventSeverityEnum = pgEnum("system_event_severity", [
  "info",
  "warn",
  "error",
]);

export const systemEvents = pgTable("system_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  // synthesis | drift | briefing | workflow | watcher | intel | deploy_smoke
  // (open-ended text — emitters define their own kinds)
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  severity: systemEventSeverityEnum("severity").notNull().default("info"),
  payload: jsonb("payload"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});
