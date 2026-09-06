// ============================================================
// BODHI — Memory Calibration Schema (Drizzle ORM)
//
// Per-type calibration table. `mineCorrectionSignals` (in the
// MemorySynthesizer) writes here on contradiction events; the
// retrieve() path multiplies importance by `scale_scale` so
// contradicted-prone types sink in ranking.
//
// Seeded with 6 known memory types at neutral (bias=0, scale=1):
//   fact | decision | pattern | preference | event | goal
//
// Phase 33 B2 (Plyrium absorption), May 25, 2026.
// Migration: packages/db/src/migrations/apply-memory-calibration.ts
// ============================================================

import { pgTable, text, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const memoryCalibration = pgTable("memory_calibration", {
  memoryType: text("memory_type").primaryKey(),
  totalSampled: integer("total_sampled").notNull().default(0),
  totalCorrect: integer("total_correct").notNull().default(0),
  biasScale: doublePrecision("bias_scale").notNull().default(0),
  scaleScale: doublePrecision("scale_scale").notNull().default(1),
  lastUpdated: timestamp("last_updated", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MemoryCalibration = InferSelectModel<typeof memoryCalibration>;
export type NewMemoryCalibration = InferInsertModel<typeof memoryCalibration>;
