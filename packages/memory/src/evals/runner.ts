#!/usr/bin/env npx tsx
// ============================================================
// BODHI — Retrieval Eval Runner
//
// Loads retrieval-fixture.json, runs each query through
// MemoryService.retrieve(), scores results against expected
// content substrings, returns aggregate Precision@5 + Recall@10.
//
// Usage as CLI:
//   npm run eval:retrieval
//   npm run eval:retrieval -- --verbose
//   npm run eval:retrieval -- --query lang-001
//
// Usage as library (e.g. scheduler cron):
//   import { runEval } from "@seneca/memory/evals/runner";
//   const report = await runEval();
// ============================================================

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb } from "@seneca/db";
import { MemoryService, type MemoryResult } from "../service.js";

export interface FixtureEntry {
  id: string;
  bucket: string;
  query: string;
  expectedContentMatches: string[];
  minPrecisionAt5?: number;
}

export interface Fixture {
  version: number;
  lastUpdated: string;
  notes?: string;
  queries: FixtureEntry[];
}

export interface QueryResult {
  id: string;
  bucket: string;
  query: string;
  precisionAt5: number;
  recallAt10: number;
  passed: boolean;
  topMatches: Array<{ content: string; matched: boolean; similarity: number }>;
}

export interface EvalReport {
  ranAt: string;
  fixtureVersion: number;
  totalQueries: number;
  aggregatePrecisionAt5: number;
  aggregateRecallAt10: number;
  passedCount: number;
  failedCount: number;
  byBucket: Record<string, { precisionAt5: number; recallAt10: number; count: number }>;
  queries: QueryResult[];
}

// Scope-boost A/B report (Jun 16) — does the §2.6 foundational +0.10 / archived
// −0.15 weighting HELP or HURT recall? Per query we retrieve twice: once with the
// boost on (production path) and once with retrieve(..., { scopeBoost:false }),
// score both with the SAME scoreQuery, and average the per-query deltas.
// recallAt10Delta = withBoost − withoutBoost; NEGATIVE means the boost HURTS.
export interface ScopeAbReport {
  ranAt: string;
  fixtureVersion: number;
  totalQueries: number;
  withBoost: { aggregatePrecisionAt5: number; aggregateRecallAt10: number };
  withoutBoost: { aggregatePrecisionAt5: number; aggregateRecallAt10: number };
  recallAt10Delta: number;
  precisionAt5Delta: number;
  crowdOut: {
    // STRICT: foundational AND recall_count<=1 AND created_at<now-90d — the
    // ~1-corpus-wide count of a genuinely-stale foundational hogging a top-K slot.
    staleFoundationalTopKSlots: number;
    // AGED (recall-agnostic): foundational AND created_at<now-90d — the real
    // signal; how many top-K slots aged foundationals occupy regardless of recall.
    agedFoundationalTopKSlots: number;
    totalTopKSlots: number;
    ratio: number;
  };
  perQueryDeltas: Array<{ id: string; recallAt10Delta: number }>;
}

// Fixture lives at packages/memory/evals/retrieval-fixture.json (alongside gold-set.md).
// Runner lives at packages/memory/src/evals/runner.ts — go up two levels to the package root.
const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "retrieval-fixture.json");

function loadFixture(): Fixture {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as Fixture;
}

function matchesContent(content: string, expected: string[]): boolean {
  const lower = content.toLowerCase();
  return expected.some((e) => lower.includes(e.toLowerCase()));
}

function scoreQuery(entry: FixtureEntry, results: MemoryResult[]): QueryResult {
  const top5 = results.slice(0, 5);
  const top10 = results.slice(0, 10);

  // Precision@5: fraction of top-5 whose content matches ANY expected substring.
  const matchedInTop5 = top5.filter((m) => matchesContent(m.content, entry.expectedContentMatches)).length;
  const precisionAt5 = top5.length === 0 ? 0 : matchedInTop5 / top5.length;

  // Recall@10: fraction of expected substrings that appear in ANY top-10 memory.
  const foundSubstrings = entry.expectedContentMatches.filter((sub) =>
    top10.some((m) => m.content.toLowerCase().includes(sub.toLowerCase())),
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
    passed,
    topMatches: top5.map((m) => ({
      content: m.content.slice(0, 120) + (m.content.length > 120 ? "…" : ""),
      matched: matchesContent(m.content, entry.expectedContentMatches),
      similarity: m.similarity,
    })),
  };
}

export async function runEval(opts: { filterQueryId?: string } = {}): Promise<EvalReport> {
  const fixture = loadFixture();
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) throw new Error("VOYAGE_API_KEY not set");

  const db = getDb();
  const memoryService = new MemoryService(db, voyageKey);

  const queries = opts.filterQueryId
    ? fixture.queries.filter((q) => q.id === opts.filterQueryId)
    : fixture.queries;

  if (queries.length === 0) {
    throw new Error(opts.filterQueryId ? `No query with id ${opts.filterQueryId}` : "Empty fixture");
  }

  const queryResults: QueryResult[] = [];
  for (const entry of queries) {
    const results = await memoryService.retrieve(entry.query, 10);
    queryResults.push(scoreQuery(entry, results));
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

// Scope-boost A/B: measure whether the §2.6 scope weighting helps recall.
// Reuses the fixture loader + scoreQuery; per query runs retrieve() twice
// (boost on, then { scopeBoost:false }) over the SAME query set, then averages
// the deltas. The crowd-out counts read scope/recallCount/createdAt straight off
// the boost-on MemoryResult rows (no 2nd query) over the top-10 of every query.
export async function runScopeAbEval(): Promise<ScopeAbReport> {
  const fixture = loadFixture();
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) throw new Error("VOYAGE_API_KEY not set");

  const db = getDb();
  const memoryService = new MemoryService(db, voyageKey);
  const queries = fixture.queries;
  if (queries.length === 0) throw new Error("Empty fixture");

  const ninetyDaysMs = 90 * 86400 * 1000;
  const now = Date.now();

  let staleFoundationalTopKSlots = 0;
  let agedFoundationalTopKSlots = 0;
  let totalTopKSlots = 0;

  const onScored: QueryResult[] = [];
  const offScored: QueryResult[] = [];
  const perQueryDeltas: Array<{ id: string; recallAt10Delta: number }> = [];

  for (const entry of queries) {
    const withBoost = await memoryService.retrieve(entry.query, 10);
    const withoutBoost = await memoryService.retrieve(entry.query, 10, undefined, { scopeBoost: false });

    const on = scoreQuery(entry, withBoost);
    const off = scoreQuery(entry, withoutBoost);
    onScored.push(on);
    offScored.push(off);
    perQueryDeltas.push({ id: entry.id, recallAt10Delta: on.recallAt10 - off.recallAt10 });

    // Crowd-out: how many top-K slots aged/stale foundationals occupy in the
    // production (boost-on) ranking. Read off the row — recallCount + scope +
    // createdAt are all SELECTed now, so no second query is needed.
    const topK = withBoost.slice(0, 10);
    for (const m of topK) {
      totalTopKSlots += 1;
      if (m.scope !== "foundational") continue;
      const ageMs = now - new Date(m.createdAt).getTime();
      const aged = ageMs > ninetyDaysMs;
      if (aged) {
        agedFoundationalTopKSlots += 1;
        if ((m.recallCount ?? 0) <= 1) staleFoundationalTopKSlots += 1;
      }
    }
  }

  const avg = (arr: QueryResult[], sel: (q: QueryResult) => number) =>
    arr.reduce((s, q) => s + sel(q), 0) / arr.length;

  const withBoost = {
    aggregatePrecisionAt5: avg(onScored, (q) => q.precisionAt5),
    aggregateRecallAt10: avg(onScored, (q) => q.recallAt10),
  };
  const withoutBoost = {
    aggregatePrecisionAt5: avg(offScored, (q) => q.precisionAt5),
    aggregateRecallAt10: avg(offScored, (q) => q.recallAt10),
  };

  return {
    ranAt: new Date().toISOString(),
    fixtureVersion: fixture.version,
    totalQueries: queries.length,
    withBoost,
    withoutBoost,
    recallAt10Delta: withBoost.aggregateRecallAt10 - withoutBoost.aggregateRecallAt10,
    precisionAt5Delta: withBoost.aggregatePrecisionAt5 - withoutBoost.aggregatePrecisionAt5,
    crowdOut: {
      staleFoundationalTopKSlots,
      agedFoundationalTopKSlots,
      totalTopKSlots,
      ratio: totalTopKSlots === 0 ? 0 : agedFoundationalTopKSlots / totalTopKSlots,
    },
    perQueryDeltas,
  };
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printReport(report: EvalReport, verbose: boolean) {
  console.log("");
  console.log(`Retrieval eval — ${report.ranAt}`);
  console.log(`Fixture v${report.fixtureVersion} · ${report.totalQueries} queries`);
  console.log("");
  console.log(`  Aggregate Precision@5: ${formatPct(report.aggregatePrecisionAt5)}`);
  console.log(`  Aggregate Recall@10:   ${formatPct(report.aggregateRecallAt10)}`);
  console.log(`  Passed: ${report.passedCount}/${report.totalQueries}`);
  console.log("");
  console.log("  By bucket:");
  for (const [bucket, b] of Object.entries(report.byBucket)) {
    console.log(`    ${bucket.padEnd(20)} P@5 ${formatPct(b.precisionAt5)} · R@10 ${formatPct(b.recallAt10)} (${b.count})`);
  }
  console.log("");

  const failed = report.queries.filter((q) => !q.passed);
  if (failed.length > 0) {
    console.log(`  Failing queries (${failed.length}):`);
    for (const q of failed) {
      console.log(`    - [${q.id}] ${q.query}`);
      console.log(`        P@5 ${formatPct(q.precisionAt5)} · R@10 ${formatPct(q.recallAt10)}`);
      if (verbose) {
        for (const m of q.topMatches) {
          const mark = m.matched ? "✓" : "·";
          console.log(`        ${mark} (sim ${m.similarity.toFixed(2)}) ${m.content}`);
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
      console.log(`        P@5 ${formatPct(q.precisionAt5)} · R@10 ${formatPct(q.recallAt10)}`);
      for (const m of q.topMatches) {
        const mark = m.matched ? "✓" : "·";
        console.log(`        ${mark} (sim ${m.similarity.toFixed(2)}) ${m.content}`);
      }
    }
  }
}

function printScopeAbReport(report: ScopeAbReport) {
  console.log("");
  console.log(`Retrieval scope A/B — ${report.ranAt}`);
  console.log(`Fixture v${report.fixtureVersion} · ${report.totalQueries} queries`);
  console.log("");
  console.log(`  Boost ON:  P@5 ${formatPct(report.withBoost.aggregatePrecisionAt5)} · R@10 ${formatPct(report.withBoost.aggregateRecallAt10)}`);
  console.log(`  Boost OFF: P@5 ${formatPct(report.withoutBoost.aggregatePrecisionAt5)} · R@10 ${formatPct(report.withoutBoost.aggregateRecallAt10)}`);
  console.log("");
  console.log(`  R@10 Δ (on−off): ${(report.recallAt10Delta * 100).toFixed(1)}pp ${report.recallAt10Delta < 0 ? "(boost HURTS)" : "(boost helps)"}`);
  console.log(`  P@5  Δ (on−off): ${(report.precisionAt5Delta * 100).toFixed(1)}pp`);
  console.log("");
  console.log(`  Crowd-out (top-10, boost-on ranking):`);
  console.log(`    aged foundational slots:  ${report.crowdOut.agedFoundationalTopKSlots}/${report.crowdOut.totalTopKSlots} (${formatPct(report.crowdOut.ratio)})`);
  console.log(`    stale foundational slots: ${report.crowdOut.staleFoundationalTopKSlots} (recall_count<=1)`);
  console.log("");
}

// CLI entry
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const argv = process.argv.slice(2);
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const queryFlag = argv.indexOf("--query");
  const filterQueryId = queryFlag >= 0 && argv[queryFlag + 1] ? argv[queryFlag + 1] : undefined;

  if (argv.includes("--scope-ab")) {
    runScopeAbEval()
      .then((report) => {
        printScopeAbReport(report);
        process.exit(report.recallAt10Delta < -0.02 ? 1 : 0);
      })
      .catch((err) => {
        console.error("[eval:scope-ab] failed:", err instanceof Error ? err.message : err);
        process.exit(2);
      });
  } else {
    runEval({ filterQueryId })
      .then((report) => {
        printReport(report, verbose);
        process.exit(report.failedCount === 0 ? 0 : 1);
      })
      .catch((err) => {
        console.error("[eval] failed:", err instanceof Error ? err.message : err);
        process.exit(2);
      });
  }
}
