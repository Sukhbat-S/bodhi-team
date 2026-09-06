// ============================================================
// BODHI — Code-symbol classifier (entity-extraction noise fix, Jun 9)
//
// The LLM entity extractor captured ~241/728 `topic` entities that are code
// symbols — React component names, .tsx files, npm packages, model IDs, ENV
// constants. They pollute the entity graph AND the every-turn AI context
// (entity-provider.ts injects an unfiltered list). This is the SINGLE source
// of truth for "is this name a code symbol we should reject/archive?".
//
// `isCodeSymbol(name)` returns TRUE (= reject/archive) for a name that matches
// ANY predicate below — AFTER a whitelist short-circuit that SPARES legitimate
// technology/domain concepts. Precision over recall: when in doubt, spare it.
// A spared symbol is a minor graph wart; an archived real concept is data loss.
// ============================================================

/**
 * WHITELIST — never treated as a code symbol. Matched case-insensitively
 * against the FULL name. These are legitimate technology / domain concepts a
 * person genuinely thinks and talks about (not code identifiers). Includes a
 * set of kebab-case domain terms that would otherwise trip the kebab-package
 * predicate (#3) — they are real BODHI/business concepts, not packages.
 */
const WHITELIST: ReadonlySet<string> = new Set(
  [
    // Languages / runtimes / platforms / protocols (real concepts)
    "React", "TypeScript", "JavaScript", "Next.js", "Node.js", "PostgreSQL",
    "Three.js", "OAuth", "GraphQL", "MCP", "API", "REST", "HTTP", "HTTPS",
    "SQL", "YAML", "JSON", "XML", "AWS", "GCP", "CSS", "HTML", "FTP",
    "SPIN", "VAPID", "НӨАТ", "ЗЭС",
    // Kebab domain terms — real concepts that look like packages (#3)
    "buildinpublic", "dombo", "order-flow-tester", "trade-review",
    "morning-research", "morning-thought", "weekly-synthesis",
    "family-presence", "founder-mode", "erkhi", "tsagaan-sar",
    "mn-ux-reviewer", "integration-checker", "build-verifier",
    "accessory", "chain",
  ].map((s) => s.toLowerCase())
);

/**
 * PREDICATES — each matches a code-identifier shape. All are inherently safe
 * for multi-word concepts ("Blue Ocean Strategy", "Applied AI Engineer")
 * because every pattern requires NO internal spaces. If ANY matches (and the
 * name is not whitelisted), the name is a code symbol.
 */
const PREDICATES: ReadonlyArray<{ re: RegExp; bucket: string }> = [
  // (1) file with a code/doc extension — App.tsx, schema.json, README.md
  { re: /\.(tsx?|jsx?|mjs|cjs|md|json|css)$/i, bucket: "file-ext" },
  // (2) PascalCase, no spaces, ≥2 humps — PaymentModal, AboutPage
  { re: /^[A-Z][a-z]+([A-Z][a-z0-9]*)+$/, bucket: "pascal-case" },
  // (3) kebab package — react-force-graph-3d (checked AFTER whitelist)
  { re: /^[a-z0-9]+(-[a-z0-9]+)+$/, bucket: "kebab-package" },
  // (4) model ID — gemini-3.1-flash-image-preview, claude-opus-4
  { re: /^(gemini|gpt|claude|sonnet|haiku|opus)[-.\d]/i, bucket: "model-id" },
  // (5) SCREAMING_SNAKE with an underscore — ANTHROPIC_API_KEY
  { re: /^[A-Z][A-Z0-9_]*_[A-Z0-9_]+$/, bucket: "screaming-snake" },
  // (6) scoped npm package — @react-three/fiber, @bodhi-crit
  { re: /^@[a-z0-9-]+(\/|$)/, bucket: "scoped-pkg" },
  // (7) REMOVED (Jun 9) — an all-caps ≥4 predicate over-matched real acronym
  // CONCEPTS the dry-run surfaced: GEPA (prompt-opt research), SENTRY (a gate
  // concept), FITD, PKCE, HDBSCAN, HNSW, USDC. Precision over recall: a bare
  // all-caps token is too often a real idea, not code. SCREAMING_SNAKE with an
  // underscore (#5) still catches ENV constants like ANTHROPIC_API_KEY.
];

/**
 * Which predicate bucket (if any) a name matches, AFTER the whitelist
 * short-circuit. Exported so the archive script can group/report by bucket
 * (and so predicate-7 — the loosest — can be surfaced separately for veto).
 * Returns null if the name is whitelisted or matches no predicate.
 */
export function codeSymbolBucket(name: string): string | null {
  if (!name) return null;
  if (WHITELIST.has(name.toLowerCase())) return null;
  for (const { re, bucket } of PREDICATES) {
    if (re.test(name)) return bucket;
  }
  return null;
}

/**
 * The single source of truth. TRUE => the name is a code symbol that should be
 * rejected at extraction time and archived in the backfill. Multi-word
 * concepts pass through (no predicate matches a name with internal spaces).
 */
export function isCodeSymbol(name: string): boolean {
  return codeSymbolBucket(name) !== null;
}
