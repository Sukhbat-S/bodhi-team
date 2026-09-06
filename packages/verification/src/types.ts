// ============================================================
// SENTRY — Phase 1 — Stryker report types
// ------------------------------------------------------------
// Types match the REAL on-disk shape of the frozen baselines
// (reports/mutation/FROZEN-BASELINE-R{2,3,5,6,7}.json), which are
// standard Stryker `mutation-test-elements` JSON reports
// (schemaVersion "1.0"). Only the fields SENTRY's pure core
// reads are required; the rest are kept optional + permissive so
// a real Stryker report parses without loss.
// ============================================================

/**
 * Stryker mutant outcome. The 4 statuses observed across all four
 * frozen baselines are Killed / Survived / Timeout / NoCoverage.
 * CompileError / RuntimeError / Ignored are part of the Stryker
 * schema and are EXCLUDED from the mutation-score denominator
 * (per Stryker's `mutationScore` definition); they are typed here
 * so a report carrying them still parses.
 */
export type MutantStatus =
  | "Killed"
  | "Survived"
  | "Timeout"
  | "NoCoverage"
  | "Ignored"
  | "CompileError"
  | "RuntimeError";

/** A single mutant as recorded in a Stryker file report. */
export interface Mutant {
  id: string;
  status: MutantStatus;
  mutatorName?: string;
  replacement?: string;
  statusReason?: string;
  static?: boolean;
  testsCompleted?: number;
  killedBy?: string[];
  coveredBy?: string[];
  location?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/** Per-file report: language + source + the mutant list. */
export interface FileReport {
  language: string;
  source: string;
  mutants: Mutant[];
}

/** A full Stryker JSON report (the frozen-baseline shape). */
export interface StrykerReport {
  schemaVersion: string | number;
  thresholds?: { high: number; low: number; break: number | null };
  files: Record<string, FileReport>;
  testFiles?: Record<string, unknown>;
  projectRoot?: string;
  config?: Record<string, unknown>;
  framework?: Record<string, unknown>;
}

/** A per-file mutation score, 0..100, computed by {@link mutationScore}. */
export type FloorManifest = Map<string, number>;
