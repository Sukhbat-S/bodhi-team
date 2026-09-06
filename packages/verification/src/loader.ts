// ============================================================
// SENTRY — Phase 1 — thin file loader (the ONLY I/O in the package)
// ------------------------------------------------------------
// Keeps the pure core (mutationFloor.ts) free of disk reads. This
// loader does the one impure thing — read + JSON.parse a baseline
// file from a path — and hands parsed reports to the pure core.
// Phase 1 is additive + isolated; nothing imports this yet.
// ============================================================

import { readFileSync } from "node:fs";

import type { StrykerReport } from "./types.js";

/** Read + parse one Stryker JSON report from disk. */
export function loadStrykerReport(path: string): StrykerReport {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as StrykerReport;
}

/** Read + parse a list of Stryker JSON reports (e.g. the frozen baselines). */
export function loadStrykerReports(paths: readonly string[]): StrykerReport[] {
  return paths.map(loadStrykerReport);
}
