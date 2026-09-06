// ============================================================
// BODHI — Correction-signal mining
//
// Pure-functional helpers for detecting implicit-feedback signals
// in user-turn text. Used by MemorySynthesizer.mineCorrectionSignals()
// to surface recurring failure modes when explicit thumbs-up/down
// capture is unavailable.
//
// Background: the explicit-thumbs feedback WRITE-path is RETIRED, not live.
// setFeedback() was retired May 19, 2026; the dashboard thumbs UI + the
// /feedback API were deleted in Phase 8 (May 15) — so conversation_turns
// .feedback has had 0 rows written since (its reader, applyFeedbackSignals,
// was deleted Jul 25 2026 after 113 synthesis runs with 0 applications; the
// DB column is kept so a future capture source needs no migration).
// Implicit corrections in user-turn text are
// therefore the ONLY feedback signal still being captured today. This
// module mines that signal.
//
// Patterns inspired by Eugene Yan's "mine your transcripts for config
// updates" (library/engineering/ai-engineering/yan-work-compound-with-ai.md)
// + Hamel Husain's error-analysis open-coding pass
// (library/engineering/ai-engineering/husain-llm-evals-faq.md §Error Analysis).
// ============================================================

export interface CorrectionHit {
  turnId: string;
  threadId: string;
  category: string;
  matched: string;
  contentSnippet: string;
}

export interface CorrectionCluster {
  category: string;
  hitCount: number;
  threadCount: number;
  uniqueThreads: string[];
  sampleSnippets: string[];
}

interface CorrectionPattern {
  category: string;
  regex: RegExp;
}

// Patterns are phrase-anchored to avoid the "no problem"/"no big deal"
// false-positive class. Bare "no" / "wrong" are NOT triggers; only
// explicit-correction phrases. Six categories, each diagnostic of a
// different model failure mode.
export const CORRECTION_PATTERNS: ReadonlyArray<CorrectionPattern> = [
  // Direct correction — user explicitly says model was wrong.
  {
    category: "correction",
    regex:
      /\b(still wrong|that['’]?s wrong|not what i|not (?:right|correct)|try again|do it again|please redo|incorrect|that['’]?s not (?:it|right))\b/i,
  },
  // Restate-intent — user clarifies after misunderstanding.
  {
    category: "restate-intent",
    regex:
      /\b(i meant|i was (?:asking|saying|trying)|what i (?:meant|wanted)|actually i|let me (?:re)?clarify|to be clear)\b/i,
  },
  // Missed-scope — model failed to anticipate something obvious.
  {
    category: "missed-scope",
    regex:
      /\b(can you also|and also,? please|while you['’]?re at it|one more thing|don['’]?t forget|forgot to|you missed)\b/i,
  },
  // Verification-miss — user prompts model to actually check its work.
  {
    category: "verification-miss",
    regex:
      /\b(did you (?:check|verify|actually|even read|look at)|are you sure|did you read|prove it|show me|how do you know)\b/i,
  },
  // Repetition — user already said something model ignored.
  {
    category: "repetition",
    regex:
      /\b(i (?:already )?(?:said|told you|mentioned)|like i (?:said|mentioned)|as i (?:said|mentioned))\b/i,
  },
  // Confusion — user can't parse model output.
  {
    category: "confusion",
    regex:
      /\b(what do you mean|i don['’]?t (?:understand|get it)|that doesn['’]?t make sense|that['’]?s (?:not clear|unclear)|huh\?)(?!\w)/i,
  },
];

/**
 * Scan a batch of user-turn messages for correction signals.
 * Multiple categories may match the same turn — each match yields a hit.
 *
 * Snippet is a window around the match (max 160 chars) to give the
 * cluster summarizer enough context without dumping full turn bodies.
 */
export function scanForCorrections(
  userMessages: Array<{ id: string; threadId: string; content: string }>,
): CorrectionHit[] {
  const hits: CorrectionHit[] = [];
  for (const turn of userMessages) {
    // Skip empty / very long turns (paste dumps inflate false positives).
    if (!turn.content || turn.content.length < 3 || turn.content.length > 5000) continue;
    for (const { category, regex } of CORRECTION_PATTERNS) {
      // Reset regex state defensively (i flag, no /g — single match is enough).
      const match = turn.content.match(regex);
      if (!match) continue;
      hits.push({
        turnId: turn.id,
        threadId: turn.threadId,
        category,
        matched: match[0],
        contentSnippet: snippetAround(turn.content, match.index ?? 0, 160),
      });
    }
  }
  return hits;
}

/**
 * Group hits by category. A cluster is emitted only if it crosses
 * BOTH thresholds — enough hits AND enough distinct threads. Single-thread
 * floods (one chatty user-turn with many matches) don't make a cluster.
 */
export function clusterHits(
  hits: CorrectionHit[],
  opts: { minHits: number; minThreads: number },
): CorrectionCluster[] {
  const byCategory = new Map<string, CorrectionHit[]>();
  for (const hit of hits) {
    const bucket = byCategory.get(hit.category) ?? [];
    bucket.push(hit);
    byCategory.set(hit.category, bucket);
  }

  const clusters: CorrectionCluster[] = [];
  for (const [category, categoryHits] of byCategory) {
    const uniqueThreads = Array.from(new Set(categoryHits.map((h) => h.threadId)));
    if (categoryHits.length < opts.minHits) continue;
    if (uniqueThreads.length < opts.minThreads) continue;

    // Up to 3 snippets, one per distinct thread if possible, otherwise just first 3.
    const samplesByThread = new Map<string, string>();
    for (const hit of categoryHits) {
      if (samplesByThread.size >= 3) break;
      if (!samplesByThread.has(hit.threadId)) samplesByThread.set(hit.threadId, hit.contentSnippet);
    }
    const sampleSnippets = Array.from(samplesByThread.values());

    clusters.push({
      category,
      hitCount: categoryHits.length,
      threadCount: uniqueThreads.length,
      uniqueThreads,
      sampleSnippets,
    });
  }
  // Stable order — most-frequent category first.
  clusters.sort((a, b) => b.hitCount - a.hitCount);
  return clusters;
}

function snippetAround(text: string, matchIndex: number, window: number): string {
  const start = Math.max(0, matchIndex - Math.floor(window / 2));
  const end = Math.min(text.length, start + window);
  let snippet = text.slice(start, end).trim();
  // Collapse whitespace runs.
  snippet = snippet.replace(/\s+/g, " ");
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}
