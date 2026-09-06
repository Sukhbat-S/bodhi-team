// SENTRY mutation-floor verification — public surface.

// Types
export type {
  MutantStatus,
  Mutant,
  FileReport,
  StrykerReport,
  FloorManifest,
} from "./types.js";

// Mutation-floor core (pure)
export {
  SAFETY_CRITICAL_KEYWORDS,
  DEFAULT_EPSILON,
  mutationScore,
  isSafetyCritical,
  loadFloorManifest,
  checkRegression,
} from "./mutationFloor.js";
export type { Regression, RegressionResult } from "./mutationFloor.js";

// Thin file loader (the only I/O in the package)
export { loadStrykerReport, loadStrykerReports } from "./loader.js";
