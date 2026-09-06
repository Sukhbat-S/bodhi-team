// ============================================================
// SENTRY — Phase 1 — mutation-floor core (PURE)
// ------------------------------------------------------------
// The mutation half of the standing self-verification organ.
//
// PURITY CONTRACT: every function in this file is a pure function
// of its arguments — no I/O, no clock, no global state, no
// mutation of inputs. Reports are passed in as already-parsed
// JSON (a thin `loadStrykerReports` file-loader lives in
// `loader.ts`). This is deliberate: the regression verdict must
// be a pure comparison of a number an EXTERNAL tool (Stryker)
// computed against a manifest the loop is forbidden to edit — the
// loop "cannot author its own verdict" (SENTRY-SPEC §"The eval
// loop"). Purity is also what makes the organ mutation-testable
// — see SELF-SUBJECTION at the bottom of this file.
// ============================================================

import type {
  FloorManifest,
  Mutant,
  StrykerReport,
} from "./types.js";

/**
 * The safety-critical keyword set — the SINGLE SOURCE OF TRUTH for
 * which modules SENTRY treats as security-relevant.
 *
 * MATCHING is BASENAME / PATH-SEGMENT aware, NOT bare substring
 * (see {@link isSafetyCritical}). A keyword matches a path when, for
 * the file's basename `b` (the segment after the last `/`):
 *   - `b === kw`                         (exact basename, e.g. extensionless)
 *   - `b.startsWith(kw + ".")`           (basename + extension: `auth.ts`)
 *   - `kw` is a full `/`-delimited path SEGMENT (e.g. an `intel/` dir)
 * Plus the `sanitiz` special-case below.
 *
 * This is deliberate: bare substring matching mis-gated real files —
 * `auth` matched `oauth.ts`/`author.ts`, `policy` matched
 * `policy-packet.ts`, `intel`
 * matched any path containing the letters. Segment matching keeps the
 * REAL safety modules and drops those false positives.
 *
 * Keep this list authoritative: `isSafetyCritical` is the only
 * consumer, and the union of these keywords with the frozen
 * baselines is what the standing gate (Phase 2) enforces. Each
 * keyword's verified real-file coverage is annotated inline.
 */
export const SAFETY_CRITICAL_KEYWORDS: readonly string[] = [
  // memory prompt-injection sanitizers — BOTH real files exist:
  // packages/memory/src/sanitize.ts AND packages/memory/src/sanitizer.ts.
  // Two keywords (not one), because under segment matching `sanitize`
  // only catches `sanitize.ts`; `sanitizer` catches `sanitizer.ts`.
  // (isSafetyCritical also folds these into a `sanitiz`-prefix guard
  // so a future `sanitization.ts` is covered too — see the matcher.)
  "sanitize", // → packages/memory/src/sanitize.ts
  "sanitizer", // → packages/memory/src/sanitizer.ts
  "policy", // defensive: a future policy.ts / <dir>/policy.ts module
  "safety", // defensive: a future *.safety.ts / safety.ts module
  "auth", // defensive: a future auth.ts / <dir>/auth.ts module
  "apiAuth", // → apps/server/src/middleware/apiAuth.ts (the API bearer gate)
  "verified-migrate", // → scripts/verified-migrate.ts
  // `fence` covers the retained standalone structural fence module and future
  // modules living under a `fence/` segment. A hyphen compound like
  // `policy-fence.ts` is NOT
  // caught — name a standalone fence `fence.ts`, not `x-fence.ts`.
  "fence", // defensive: standalone fence.ts / <dir>/fence.ts if/when one lands
] as const;

/**
 * Default float-noise tolerance for the regression comparison.
 * Stryker scores are floating point; a file only "regresses" when
 * it drops more than this many percentage points below its floor.
 */
export const DEFAULT_EPSILON = 0.5;

/**
 * Stryker's `mutationScore`, per the official definition:
 *
 *   score = (Killed + Timeout) / (Killed + Survived + Timeout + NoCoverage) * 100
 *
 * Ignored / CompileError / RuntimeError are EXCLUDED from the
 * denominator (they are not "detected" outcomes and not "valid"
 * mutants). Returns `null` when the denominator is zero (a file
 * with no scoreable mutants has no defined score / no floor).
 *
 * P2-GATE NOTE (for the future Phase-2 author): the SENTRY gate is
 * PER-FILE — `checkRegression` compares each file's fresh score
 * against that file's frozen floor. The global aggregate (the
 * ~94.90% R6 headline number) is computed by running THIS function
 * over the FLATTENED mutant pool of EVERY file at once (see the
 * "matches the R6 aggregate" test). The two are NOT interchangeable:
 * an "aggregate regressed?" verdict MUST be computed the global-pool
 * way — flatten all mutants, call `mutationScore` once — and NEVER by
 * averaging the per-file floors (a count-weighted pool ≠ an unweighted
 * mean of per-file scores). The per-file floors exist only to gate
 * individual files; treat the global number as a separate,
 * formula-sanity assertion.
 */
export function mutationScore(mutants: readonly Mutant[]): number | null {
  let killed = 0;
  let survived = 0;
  let timeout = 0;
  let noCoverage = 0;

  for (const m of mutants) {
    switch (m.status) {
      case "Killed":
        killed++;
        break;
      case "Survived":
        survived++;
        break;
      case "Timeout":
        timeout++;
        break;
      case "NoCoverage":
        noCoverage++;
        break;
      // Ignored / CompileError / RuntimeError: excluded from the score.
      default:
        break;
    }
  }

  const denominator = killed + survived + timeout + noCoverage;
  if (denominator === 0) return null;
  return ((killed + timeout) / denominator) * 100;
}

/**
 * `true` when a file's mutants amount to zero mutation coverage —
 * i.e. nothing was Killed and nothing Survived. In practice this
 * means every mutant is NoCoverage (or the file carries no
 * scoreable mutants at all). Used to detect a safety-critical file
 * that has shipped with no protective tests.
 */
function hasZeroCoverage(mutants: readonly Mutant[]): boolean {
  for (const m of mutants) {
    if (m.status === "Killed" || m.status === "Survived") return false;
  }
  return true;
}

/**
 * Does `keyword` match `path` under BASENAME / PATH-SEGMENT rules?
 *
 * Split the path on `/`. Let `b` be the basename (last segment). For a
 * keyword WITHOUT a `/`, it matches when ANY of:
 *   1. `b === kw`                  — exact basename (extensionless module)
 *   2. `b.startsWith(kw + ".")`    — basename + extension, e.g. `auth.ts`
 *   3. some interior segment `=== kw` — a `/`-delimited dir/segment,
 *      e.g. `apiAuth` in `…/middleware/apiAuth.ts`, or `intel` in
 *      `…/services/intel/fence.ts`.
 *
 * It deliberately does NOT do `b.includes(kw)`: that is what produced
 * the `oauth.ts`←`auth` and `policy-packet.ts`←`policy` false positives.
 *
 *   4. PATH-QUALIFIED keyword: a keyword CONTAINING a `/` is a
 *      two-segment suffix qualifier `dirSeg/baseKw`. It matches iff some
 *      ADJACENT segment pair has `segments[i] === dirSeg` AND
 *      (`segments[i+1] === baseKw` OR `segments[i+1].startsWith(baseKw + ".")`).
 *      This narrows a keyword to a specific parent directory without matching
 *      same-named declarations elsewhere. A non-adjacent `dirSeg`/`baseKw`
 *      pair does not match.
 */
function keywordMatchesPath(kw: string, path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? path;

  // Rule 4: a `/`-bearing keyword is a `dirSeg/baseKw` suffix qualifier.
  // Match only an ADJACENT segment pair — never the bare basename
  // elsewhere, and never a non-adjacent dir/base coincidence.
  if (kw.includes("/")) {
    const [dirSeg, baseKw] = kw.split("/");
    for (let i = 0; i < segments.length - 1; i++) {
      if (
        segments[i] === dirSeg &&
        (segments[i + 1] === baseKw ||
          segments[i + 1].startsWith(baseKw + "."))
      ) {
        return true;
      }
    }
    return false;
  }

  // Rules 1 + 2 on the basename.
  if (basename === kw) return true;
  if (basename.startsWith(kw + ".")) return true;

  // Rule 3: keyword is a full path SEGMENT. Check every segment
  // (basename included — already covered by rules 1/2, harmless).
  for (const seg of segments) {
    if (seg === kw) return true;
  }

  return false;
}

/**
 * Is this file path safety-critical? PATH-SEGMENT / basename-aware
 * match over {@link SAFETY_CRITICAL_KEYWORDS} (the single source of
 * truth) — NOT a bare substring match.
 *
 * Special case: the prompt-injection sanitizers ship as BOTH
 * `sanitize.ts` and `sanitizer.ts` (and a future `sanitization.ts`
 * would be the same family), so any basename whose name-part starts
 * with `sanitiz` is treated as safety-critical. This is the one
 * intentional prefix rule; everything else is exact basename /
 * basename+ext / full segment.
 */
export function isSafetyCritical(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? path;
  // `sanitiz` family: catch sanitize.ts, sanitizer.ts, sanitization.ts…
  // (basename-anchored so it never matches a mid-path coincidence).
  if (basename.startsWith("sanitiz")) return true;

  return SAFETY_CRITICAL_KEYWORDS.some((kw) => keywordMatchesPath(kw, path));
}

/**
 * Build the frozen floor manifest: the union of the supplied
 * baselines, mapping each file path → its proven mutation score.
 *
 * On a file present in more than one baseline, the HIGHER score
 * wins — the floor is the BEST proven state of that module, never
 * a regression to a weaker round. Files with no defined score
 * (zero scoreable mutants) are omitted: there is no floor to hold.
 *
 * PURE: reads only the passed-in reports; returns a fresh Map.
 */
export function loadFloorManifest(
  baselines: readonly StrykerReport[],
): FloorManifest {
  const manifest: FloorManifest = new Map();

  for (const report of baselines) {
    for (const [path, fileReport] of Object.entries(report.files)) {
      const score = mutationScore(fileReport.mutants);
      if (score === null) continue;

      const existing = manifest.get(path);
      if (existing === undefined || score > existing) {
        manifest.set(path, score);
      }
    }
  }

  return manifest;
}

/** A single floor regression: a file scoring below its frozen floor. */
export interface Regression {
  file: string;
  floor: number;
  current: number;
}

/** The result of a regression check. */
export interface RegressionResult {
  /** Files whose fresh score dropped below `floor - epsilon`. */
  regressed: Regression[];
  /**
   * Safety-critical files that appear in the fresh report with zero
   * mutation coverage AND have no floor in the manifest (i.e. NEW
   * safety-critical files shipped untested). An existing safety file
   * that regresses is reported via `regressed`, not here.
   */
  newUncoveredSafetyFiles: string[];
  /**
   * Floored files (present in the manifest) that are ABSENT from the
   * fresh report — renamed, moved, or scoped out of the Stryker run.
   * Such a file silently un-gates: it has a proven floor but no fresh
   * score to compare against, so it would never appear in `regressed`.
   *
   * This pure function only SURFACES them — it does NOT auto-fail. The
   * fail/allow decision is the P2 gate's policy call: P2 should treat a
   * missing SAFETY-CRITICAL floored file as suspicious (a safety module
   * that vanished from the run), while a missing ordinary floored file
   * may be a legitimate rename. Cross-reference each entry with
   * {@link isSafetyCritical} to distinguish the two.
   */
  missingFromFresh: string[];
}

/**
 * Compare a fresh Stryker report against the frozen floor manifest.
 *
 * A file REGRESSES when its current score is strictly below
 * `floor - epsilon` (epsilon absorbs float noise; default 0.5).
 * A file meeting or exceeding its floor — within epsilon — does
 * not regress.
 *
 * A file is a NEW UNCOVERED SAFETY FILE when it is safety-critical
 * (per {@link isSafetyCritical}), is NOT in the manifest (no proven
 * floor), and ships with zero mutation coverage. A new NON-safety
 * file with zero coverage is intentionally NOT flagged — SENTRY
 * gates the safety-critical set only.
 *
 * PURE: reads only its arguments; returns a fresh result object.
 */
export function checkRegression(
  manifest: FloorManifest,
  fresh: StrykerReport,
  opts?: { epsilon?: number },
): RegressionResult {
  const epsilon = opts?.epsilon ?? DEFAULT_EPSILON;

  const regressed: Regression[] = [];
  const newUncoveredSafetyFiles: string[] = [];

  for (const [path, fileReport] of Object.entries(fresh.files)) {
    const floor = manifest.get(path);
    const current = mutationScore(fileReport.mutants);

    if (floor !== undefined) {
      // Known file with a proven floor: compare scores.
      // A file with no defined current score (zero scoreable
      // mutants) but a known floor is a regression to nothing —
      // treat current as 0 for the comparison.
      const currentScore = current ?? 0;
      if (currentScore < floor - epsilon) {
        regressed.push({ file: path, floor, current: currentScore });
      }
      continue;
    }

    // New file (no floor). Only safety-critical files with zero
    // coverage are flagged; ordinary new files are not SENTRY's
    // concern.
    if (isSafetyCritical(path) && hasZeroCoverage(fileReport.mutants)) {
      newUncoveredSafetyFiles.push(path);
    }
  }

  // Floored files that vanished from the fresh report. Iterate the
  // MANIFEST keys (not fresh) — that is the whole point: these never
  // show up in the loop above, so without this pass they un-gate
  // silently. Surface them; P2 decides (a missing safety-critical
  // floor is suspicious, see RegressionResult.missingFromFresh).
  const missingFromFresh: string[] = [];
  for (const flooredPath of manifest.keys()) {
    if (!(flooredPath in fresh.files)) {
      missingFromFresh.push(flooredPath);
    }
  }

  return { regressed, newUncoveredSafetyFiles, missingFromFresh };
}

// ============================================================
// SELF-SUBJECTION (SENTRY-SPEC §"Self-subjection"):
// Every function above is PURE and exhaustively unit-tested
// (mutationFloor.test.ts), so these modules are themselves
// mutation-test-ready — the organ that enforces the floor can be
// placed BELOW its own floor. Stryker is NOT run on this package
// in Phase 1 (heavy, deferred); the readiness is the point.
// ============================================================
