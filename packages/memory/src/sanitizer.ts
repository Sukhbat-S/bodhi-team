// ============================================================
// BODHI — memory sanitizer (Phase 33 B3, May 25, 2026)
//
// 3 categories tuned to BODHI's single-user threat model:
//   1. system_override — prompt-injection attempts
//   2. recursive_amplify — embedded MCP / Agent tool calls
//   3. exfil_via_tool   — credential / secret patterns
//
// First-match-wins. Idempotent. Body never echoed when blocked.
//
// Mode: 'warn' (default) — log + pass-through.
//       'block' — replace content with [REDACTED: <category>]
//
// Phase 33 C1 (May 25): when an AuditSink is passed in opts.audit, every
// category match emits an append-only audit row (kind=memory.sanitize,
// severity=warn). Hash-not-body — the matched content is passed as
// `payload` and SHA-256-hashed inside the sink; `summary` carries only
// the category name + source tag (PII-free).
// ============================================================

import type { AuditSink } from "./drift-scanner.js";

export type SanitizerKind = "pass" | "warn" | "block";
export type SanitizerCategory =
  | "system_override"
  | "recursive_amplify"
  | "exfil_via_tool"
  | null;

export interface SanitizerVerdict {
  kind: SanitizerKind;
  category: SanitizerCategory;
  sanitized: string;  // Original text if pass/warn; [REDACTED] placeholder if block
  matched?: string;   // The matched substring (truncated to 80 chars for logging)
}

// ── security-chain-3 (May 31): DEFENSE-IN-DEPTH, NOT a complete filter ──
// This regex sanitizer narrows the prompt-injection surface; it can never be
// exhaustive. The real boundary is the structural fence (security-chain-1,
// core/agent.ts — held for architect go) that wraps ALL external content in
// <untrusted-external-data> regardless of phrasing. Known ceiling (bodhi-security
// May 31): English synonyms (`disregard`) and Mongolian-LANGUAGE injection verbs
// are NOT covered — MN-verb patterns are held for the architect since they risk
// false-positives on his primary-language prose. What this layer DOES close:
//   • ASCII-homoglyph injection (Cyrillic о/е/р/і shaped like Latin o/e/p/i)
//   • pure-Cyrillic Russian injection (native игнорир…инструкци alternation)
//   • obfuscation: zero-width splits (ig<ZWSP>nore), combining diacritics
//     (ignóre), and compatibility forms (fullwidth) — stripped before scan.
// Clean Mongolian Cyrillic prose folds to harmless text (no false-positive).
const CONFUSABLES: Record<string, string> = {
  // lowercase
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x",
  і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w",
  // uppercase
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O",
  Р: "P", С: "C", Т: "T", У: "Y", Х: "X", І: "I", Ј: "J", Ѕ: "S",
};

// Strip an attacker's obfuscation BEFORE folding/scanning: NFKD decomposes
// compatibility (fullwidth ｉ→i) + combining (ó→o+◌́) forms; then drop combining
// marks and zero-width joiners/spaces so `ig<ZWSP>nore` and `ignóre` reconstruct
// to `ignore`. NFKD (not NFKC) so precomposed diacritics decompose for stripping.
function normalizeForScan(s: string): string {
  return s
    .normalize("NFKD")
    // zero-width space/non-joiner/joiner, word-joiner, BOM
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\p{M}/gu, ""); // combining marks
}

function foldConfusables(s: string): string {
  let out = "";
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}

const PATTERNS: Array<{ category: Exclude<SanitizerCategory, null>; regex: RegExp }> = [
  // 1. system_override — prompt-injection markers.
  // The `игнорир…инструкци` alternation catches PURE-Cyrillic Russian injection,
  // which the confusable fold can't recover (и/г/н have no Latin lookalike).
  // [Ѐ-ӿ] = the Cyrillic block (covers Mongolian ү/ө too).
  {
    category: "system_override",
    regex: /(ignore\s+(?:previous|prior|earlier|above)\s+instructions?|игнорир[Ѐ-ӿ]*[\s\S]{0,40}инструкци[Ѐ-ӿ]*|\[INST\]|<<SYS>>|<\|im_start\|>|^SYSTEM:|^ASSISTANT:|^USER:)/im,
  },
  // 1b. system_override — Mongolian-language injection (sc-1 follow-up, May 31,
  // architect-validated). DEFENSE-IN-DEPTH behind the language-agnostic fence —
  // HIGH-PRECISION only: an instruction-noun (заавар/дүрэм/команд/тушаал) MUST be
  // paired with a disobey-imperative (үл тоомсор/үл хэрэгс/орхигдуул/бүү дага), or
  // өмнөх-instructions+март, never a bare noun (өмнөх/заавар are everyday words).
  // `бүү дага` (imperative) not `дагуу/дагасан` (benign) avoids false-positives.
  // [Ѐ-ӿ\s]{0,N} gaps absorb agglutinative case suffixes. Plus reveal-prompt,
  // authority-claim, and jailbreak-mode markers (all low-FP).
  {
    category: "system_override",
    regex: /(заавар|заавр|дүрэм|дүрм|команд|тушаал)[Ѐ-ӿ\s]{0,20}(үл\s+тоомсор|үл\s+хэрэгс|орхигдуул|бүү\s+дага)|(өмнөх|дээрх)[Ѐ-ӿ\s]{0,20}(заавар|заавр|дүрэм|дүрм)[Ѐ-ӿ\s]{0,15}март|(системийн|далд|нууц)[Ѐ-ӿ\s]{0,15}(заавар|заавр)[Ѐ-ӿ\s]{0,15}(харуул|ил\s+гарга|үзүүл)|би\s+таны\s+(хөгжүүлэгч|админ|эзэн)|(хязгааргүй|чөлөөт)\s+горим/im,
  },
  // 2. recursive_amplify — embedded MCP / Agent tool calls
  {
    category: "recursive_amplify",
    regex: /(mcp__bodhi__store_memory\s*\(|Agent\s*\(\s*\{[^}]*subagent_type:|<<<\s*tool_use|\bcurl\s+[^|]*localhost:4000\/api\/(?:memories|agent-dispatches)\b)/im,
  },
  // 3. exfil_via_tool — credentials / secrets
  {
    category: "exfil_via_tool",
    regex: /(\.aws\/credentials|\.ssh\/id_(?:rsa|ed25519|ecdsa|dsa)|PLYRIUM_AGENT_TOKEN|GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|VOYAGE_API_KEY|GOOGLE_CLIENT_SECRET|TELEGRAM_BOT_TOKEN|VERCEL_TOKEN|(?:cat|less|tail)\s+[^|]*\.env(?:\s|$)|export\s+(?:OPENAI|ANTHROPIC)_API_KEY)/im,
  },
];

export interface SanitizeOptions {
  mode?: "warn" | "block";
  source?: string; // For logging context: 'memory.retrieve' | 'policy-packet.recentFeedback' | ...
  /**
   * Optional audit sink (Phase 33 C1). When provided, every category
   * match writes a `memory.sanitize` audit row (severity=warn).
   * Best-effort — sink failures must NOT change the sanitize() return.
   */
  audit?: AuditSink | null;
}

export function sanitize(text: string, opts: SanitizeOptions = {}): SanitizerVerdict {
  if (!text || typeof text !== "string") {
    return { kind: "pass", category: null, sanitized: text ?? "" };
  }

  const mode = opts.mode ?? "warn";
  const source = opts.source ?? "unknown";

  // security-chain-3: scan the raw text AND a de-obfuscated, confusable-folded
  // copy. normalizeForScan strips zero-width/combining/compatibility tricks; the
  // fold recovers Latin-shaped Cyrillic homoglyphs (`іgnоrе` → `ignore`). The raw
  // scan + the native Cyrillic alternation cover pure-Cyrillic injection.
  const folded = foldConfusables(normalizeForScan(text));
  const scanTargets = folded === text ? [text] : [text, folded];

  for (const { category, regex } of PATTERNS) {
    let match: RegExpExecArray | null = null;
    for (const target of scanTargets) {
      match = regex.exec(target);
      if (match) break;
    }
    if (match) {
      const matched = match[0].slice(0, 80);

      // Phase 33 C1: emit audit row on every match (warn OR block).
      // Hash-not-body — pass the full matched text as `payload`; the AuditSink
      // hashes via SHA-256 before persistence. Human-readable line lives in
      // metadata.summary (the server-side AuditService schema has no top-level
      // `summary` field). Best-effort — failures must NOT change the verdict.
      if (opts.audit) {
        opts.audit.write({
          kind: "memory.sanitize",
          actor: "sanitizer",
          payload: matched,
          metadata: {
            summary: `${category} matched on retrieval (source=${source}, mode=${mode})`,
            category,
            source,
            mode,
            severity: "warn",
          },
        }).catch((err) => {
          console.error("[sanitizer] audit.write failed:", err instanceof Error ? err.message : err);
        });
      }

      if (mode === "warn") {
        // Log + pass-through. Caller can grep stderr for [sanitizer warn] entries.
        console.error(
          `[sanitizer warn] source=${source} category=${category} matched="${matched.replace(/\s+/g, " ")}"`,
        );
        return { kind: "warn", category, sanitized: text, matched };
      }
      // block mode
      console.error(
        `[sanitizer block] source=${source} category=${category} matched="${matched.replace(/\s+/g, " ")}"`,
      );
      return {
        kind: "block",
        category,
        sanitized: `[REDACTED: ${category}]`,
        matched,
      };
    }
  }

  return { kind: "pass", category: null, sanitized: text };
}

/**
 * Convenience: sanitize a memory-content string, returning the
 * sanitized text plus the verdict for caller logging.
 *
 * Phase 33 C1: accepts an optional AuditSink so retrieval-boundary
 * callers can wire audit-on-match without restructuring as a class.
 */
export function sanitizeMemoryContent(
  content: string,
  source?: string,
  audit?: AuditSink | null,
): {
  content: string;
  verdict: SanitizerVerdict;
} {
  const verdict = sanitize(content, { mode: "warn", source, audit });
  return { content: verdict.sanitized, verdict };
}
