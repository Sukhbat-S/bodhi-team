#!/usr/bin/env npx tsx
// ============================================================
// BODHI — Library Retrieval Eval Runner (Wave F, Jun 10 2026)
//
// The library's FIRST recall signal. Loads
// evals/library-retrieval-fixture.json, runs each query through
// LibraryService.search() (the real production search path, with the
// production threshold), scores hits against expected chunk-text
// substrings, returns aggregate Precision@5 + Recall@10.
//
// Shape cloned from packages/memory/src/evals/runner.ts so the two
// retrieval evals stay comparable. One deliberate difference:
// searches run with telemetry:false — a weekly fixture sweep must not
// emit library-cite events (it would mark every covered source as
// "recently cited" and blind detectStale + the curation cron) or
// inflate consultation stats. Never fake the eval signal.
//
// Usage as CLI:
//   npx tsx packages/library/src/evals/runner.ts
//   npx tsx packages/library/src/evals/runner.ts --verbose
//   npx tsx packages/library/src/evals/runner.ts --query lib-mn-016
//
// Usage as library (scheduler cron `library-retrieval-eval`):
//   import { runLibraryEval } from "@seneca/library";
//   const report = await runLibraryEval();
// ============================================================

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb } from "@seneca/db";
import { LibraryService, type LibraryHit } from "../service.js";

export interface LibraryFixtureEntry {
  id: string;
  bucket: string;
  /** Production librarian calls pass a domain filter — the fixture mirrors that. */
  domain?: string | null;
  query: string;
  expectedContentMatches: string[];
  minPrecisionAt5?: number;
}

export interface LibraryFixture {
  version: number;
  lastUpdated: string;
  notes?: string;
  queries: LibraryFixtureEntry[];
}

export interface LibraryQueryResult {
  id: string;
  bucket: string;
  query: string;
  precisionAt5: number;
  recallAt10: number;
  /** Raw hits returned (≤10). P@5's denominator is top5.length, so a sparse
   *  return (e.g. 1 matching hit) scores P@5=1.0 — read hitCount alongside. */
  hitCount: number;
  passed: boolean;
  topMatches: Array<{ source: string; content: string; matched: boolean; similarity: number }>;
}

export interface LibraryEvalReport {
  ranAt: string;
  fixtureVersion: number;
  totalQueries: number;
  aggregatePrecisionAt5: number;
  aggregateRecallAt10: number;
  passedCount: number;
  failedCount: number;
  byBucket: Record<string, { precisionAt5: number; recallAt10: number; count: number }>;
  queries: LibraryQueryResult[];
}

// Fixture lives at packages/library/evals/library-retrieval-fixture.json.
// Runner lives at packages/library/src/evals/runner.ts — up two to the package root.
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "evals",
  "library-retrieval-fixture.json",
);

function loadFixture(): LibraryFixture {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as LibraryFixture;
}

function matchesContent(content: string, expected: string[]): boolean {
  const lower = content.toLowerCase();
  return expected.some((e) => lower.includes(e.toLowerCase()));
}

/**
 * Retry-with-backoff (Library Health Loop, Jun 30 2026). The eval's only
 * external dependency is the Voyage embed inside LibraryService.search(); a
 * transient `fetch failed` (the Mac's network flapping on wake, or a brief
 * Voyage blip) was erroring the WHOLE sweep — the exact failure that killed the
 * Jun 21 + 28 runs. Retry each search up to `attempts` times with exponential
 * backoff. The ORIGINAL error is re-thrown on exhaustion (message preserved) so
 * the scheduler's offline-classifier can still tell a real eval break from a
 * connectivity blip. Never fake the eval signal — a true outage still surfaces.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function scoreQuery(entry: LibraryFixtureEntry, hits: LibraryHit[]): LibraryQueryResult {
  const top5 = hits.slice(0, 5);
  const top10 = hits.slice(0, 10);

  // Precision@5: fraction of top-5 whose chunk_text matches ANY expected substring.
  const matchedInTop5 = top5.filter((h) => matchesContent(h.chunk_text, entry.expectedContentMatches)).length;
  const precisionAt5 = top5.length === 0 ? 0 : matchedInTop5 / top5.length;

  // Recall@10: fraction of expected substrings that appear in ANY top-10 chunk.
  const foundSubstrings = entry.expectedContentMatches.filter((sub) =>
    top10.some((h) => h.chunk_text.toLowerCase().includes(sub.toLowerCase())),
  );
  const recallAt10 = entry.expectedContentMatches.length === 0
    ? 0
    : foundSubstrings.length / entry.expectedContentMatches.length;

  const threshold = entry.minPrecisionAt5 ?? 0.2;
  const passed = precisionAt5 >= threshold;

  return {
    id: entry.id,
    bucket: entry.bucket,
    query: entry.query,
    precisionAt5,
    recallAt10,
    hitCount: hits.length,
    passed,
    topMatches: top5.map((h) => ({
      source: h.source,
      content: h.chunk_text.slice(0, 120) + (h.chunk_text.length > 120 ? "…" : ""),
      matched: matchesContent(h.chunk_text, entry.expectedContentMatches),
      similarity: h.similarity,
    })),
  };
}

export async function runLibraryEval(opts: { filterQueryId?: string } = {}): Promise<LibraryEvalReport> {
  const fixture = loadFixture();
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) throw new Error("VOYAGE_API_KEY not set");

  const db = getDb();
  const libraryService = new LibraryService(db, voyageKey);

  const queries = opts.filterQueryId
    ? fixture.queries.filter((q) => q.id === opts.filterQueryId)
    : fixture.queries;

  if (queries.length === 0) {
    throw new Error(opts.filterQueryId ? `No query with id ${opts.filterQueryId}` : "Empty fixture");
  }

  const queryResults: LibraryQueryResult[] = [];
  for (const entry of queries) {
    // Production search path + production threshold (default 0.25), limit 10
    // for R@10. telemetry:false — see the header comment. Wrapped in withRetry
    // so a transient Voyage `fetch failed` (the embed call inside search())
    // doesn't error the whole run (Library Health Loop, Jun 30).
    const result = await withRetry(() =>
      libraryService.search({
        query: entry.query,
        domain: entry.domain ?? null,
        limit: 10,
        agent_context: "service:library-eval",
        telemetry: false,
      }),
    );
    queryResults.push(scoreQuery(entry, result.hits));
  }

  const aggregatePrecisionAt5 =
    queryResults.reduce((s, q) => s + q.precisionAt5, 0) / queryResults.length;
  const aggregateRecallAt10 =
    queryResults.reduce((s, q) => s + q.recallAt10, 0) / queryResults.length;

  const byBucket: Record<string, { precisionAt5: number; recallAt10: number; count: number }> = {};
  for (const r of queryResults) {
    const b = (byBucket[r.bucket] ??= { precisionAt5: 0, recallAt10: 0, count: 0 });
    b.precisionAt5 += r.precisionAt5;
    b.recallAt10 += r.recallAt10;
    b.count += 1;
  }
  for (const b of Object.values(byBucket)) {
    b.precisionAt5 = b.precisionAt5 / b.count;
    b.recallAt10 = b.recallAt10 / b.count;
  }

  return {
    ranAt: new Date().toISOString(),
    fixtureVersion: fixture.version,
    totalQueries: queryResults.length,
    aggregatePrecisionAt5,
    aggregateRecallAt10,
    passedCount: queryResults.filter((q) => q.passed).length,
    failedCount: queryResults.filter((q) => !q.passed).length,
    byBucket,
    queries: queryResults,
  };
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printReport(report: LibraryEvalReport, verbose: boolean) {
  console.log("");
  console.log(`Library retrieval eval — ${report.ranAt}`);
  console.log(`Fixture v${report.fixtureVersion} · ${report.totalQueries} queries`);
  console.log("");
  console.log(`  Aggregate Precision@5: ${formatPct(report.aggregatePrecisionAt5)}`);
  console.log(`  Aggregate Recall@10:   ${formatPct(report.aggregateRecallAt10)}`);
  console.log(`  Passed: ${report.passedCount}/${report.totalQueries}`);
  console.log("");
  console.log("  By bucket:");
  for (const [bucket, b] of Object.entries(report.byBucket)) {
    console.log(`    ${bucket.padEnd(24)} P@5 ${formatPct(b.precisionAt5)} · R@10 ${formatPct(b.recallAt10)} (${b.count})`);
  }
  console.log("");

  const failed = report.queries.filter((q) => !q.passed);
  if (failed.length > 0) {
    console.log(`  Failing queries (${failed.length}):`);
    for (const q of failed) {
      console.log(`    - [${q.id}] ${q.query}`);
      console.log(`        P@5 ${formatPct(q.precisionAt5)} · R@10 ${formatPct(q.recallAt10)} · hits ${q.hitCount}`);
      if (verbose) {
        for (const m of q.topMatches) {
          const mark = m.matched ? "✓" : "·";
          console.log(`        ${mark} (sim ${m.similarity.toFixed(2)}) [${m.source}] ${m.content}`);
        }
      }
    }
    console.log("");
  }

  if (verbose) {
    console.log("  All queries (verbose):");
    for (const q of report.queries) {
      const status = q.passed ? "PASS" : "FAIL";
      console.log(`    [${status}] ${q.id} — ${q.query}`);
      console.log(`        P@5 ${formatPct(q.precisionAt5)} · R@10 ${formatPct(q.recallAt10)} · hits ${q.hitCount}`);
      for (const m of q.topMatches) {
        const mark = m.matched ? "✓" : "·";
        console.log(`        ${mark} (sim ${m.similarity.toFixed(2)}) [${m.source}] ${m.content}`);
      }
    }
  }
}

// CLI entry
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const argv = process.argv.slice(2);
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const queryFlag = argv.indexOf("--query");
  const filterQueryId = queryFlag >= 0 && argv[queryFlag + 1] ? argv[queryFlag + 1] : undefined;

  runLibraryEval({ filterQueryId })
    .then((report) => {
      printReport(report, verbose);
      process.exit(report.failedCount === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error("[library-eval] failed:", err instanceof Error ? err.message : err);
      process.exit(2);
    });
}
