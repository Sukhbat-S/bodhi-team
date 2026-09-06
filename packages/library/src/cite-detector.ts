// ============================================================
// @seneca/library — cite-detector
//
// Detects library citations in agent/briefing output text.
// Closes May 21 5-open-loops #1 (library cite-rate → Attunement
// signal). Pure utility — no DB, no LLM. Called by:
//   - briefings.ts post-generation
//   - the post-dispatch wrapper (Wave 10 agent-substrate phase)
//
// The library returns hits with a `source` path like
// `design/podcasts/dive-club/synthesis-2026-05-09.md` and a
// `heading` from the cited chunk. Agents that use the library
// well will quote both — verbatim path + § heading. This
// detector catches both styles:
//   1. Exact path quote: "design/podcasts/..." or "engineering/..."
//   2. Italic source attribution: *"...design/..."* or _design/_
//   3. Path + heading: "design/.../foo.md § 1.2 Headline"
//
// Why pure regex instead of LLM: the patterns are unambiguous
// (slashes + domain prefix + .md extension or close), the cost
// must stay zero so it can run after every dispatch, and false
// positives are tolerable (the synthesis layer dedupes).
//
// Cross-references:
// Historical agent-dispatch captures may still contain citation-shaped findings.
// - SUBSTRATE.md §8 (library tier)
// - pattern_three_loop_attunement_model_may21
// ============================================================

export interface LibraryCitation {
  /** Path or partial path of the cited library source. */
  source: string;
  /** Optional heading (§ marker) when the citation includes one. */
  heading?: string;
  /** Domain the source belongs to (design / engineering / security / research / interaction). */
  domain: string;
  /** 0.0–1.0 — how confident the regex is this is a real citation. */
  confidence: number;
}

const KNOWN_DOMAINS = [
  "design",
  "engineering",
  "security",
  "research",
  "interaction",
] as const;

const DOMAIN_PREFIX = KNOWN_DOMAINS.join("|");

// Path-like reference: domain/sub-domain/.../filename(.md)?
// Optional § heading following.
//
// Examples it should match:
//   design/podcasts/dive-club/synthesis-2026-05-09.md § 1.2 The final 10%
//   engineering/fundamentals/hunt-thomas-pragmatic-programmer.md § DRY
//   design/color-theory/treisman-preattentive
//
// Anchored to whitespace or punctuation boundaries so prose like
// "the design system" doesn't false-match.
const PATH_RE = new RegExp(
  // boundary: start, whitespace, quote, paren, bracket, asterisk, underscore, or backtick
  `(?:^|[\\s"'(\\[*_\`])` +
    // domain prefix capture
    `(${DOMAIN_PREFIX})\\/` +
    // path body: word chars, hyphens, slashes, dots — at least one more segment
    `([a-z0-9][a-z0-9_\\-./]*?[a-z0-9])` +
    // optional .md
    `(?:\\.md)?` +
    // optional § heading
    `(?:\\s*§\\s*([^\\n*_"'\\]\\)\\\\]+?))?` +
    // boundary: end, whitespace, punctuation, quote, asterisk, underscore, backtick
    `(?=[\\s.,;:!?*_"'\\\\\\])\\}]|$)`,
  "gi",
);

/**
 * Detects library citations in a block of text. Returns an array
 * of unique citations (deduped by source+heading).
 *
 * @param text — agent or briefing output to scan
 * @param opts — optional context
 * @returns array of LibraryCitation
 */
export function detectCitations(
  text: string,
  opts?: { /** Known library sources that were injected this turn, for relevance scoring. */ injectedSources?: string[] },
): LibraryCitation[] {
  if (!text || text.length < 8) return [];

  const seen = new Map<string, LibraryCitation>();
  const injected = new Set(opts?.injectedSources ?? []);

  let match: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((match = PATH_RE.exec(text)) !== null) {
    const [, domain, body, headingRaw] = match;
    if (!domain || !body) continue;

    const source = `${domain}/${body}`;
    const heading = headingRaw?.trim() || undefined;
    const key = `${source}::${heading ?? ""}`;
    if (seen.has(key)) continue;

    // Confidence: 0.7 base. Boost if the source also appears in
    // injectedSources (means library actually pushed it this turn).
    // Boost if heading is present (agent quoted the § marker).
    let confidence = 0.7;
    if (injected.has(source) || [...injected].some((s) => s.startsWith(source))) {
      confidence += 0.2;
    }
    if (heading) confidence += 0.1;
    confidence = Math.min(1, confidence);

    seen.set(key, { source, heading, domain, confidence });
  }

  return [...seen.values()];
}

/**
 * Formats citations for telemetry payload — small, scannable.
 */
export function summarizeCitations(citations: LibraryCitation[]): {
  count: number;
  byDomain: Record<string, number>;
  avgConfidence: number;
  sources: string[];
} {
  if (citations.length === 0) {
    return { count: 0, byDomain: {}, avgConfidence: 0, sources: [] };
  }
  const byDomain: Record<string, number> = {};
  let totalConf = 0;
  const sources: string[] = [];
  for (const c of citations) {
    byDomain[c.domain] = (byDomain[c.domain] ?? 0) + 1;
    totalConf += c.confidence;
    sources.push(c.source);
  }
  return {
    count: citations.length,
    byDomain,
    avgConfidence: totalConf / citations.length,
    sources,
  };
}
