// ============================================================
// @seneca/library — retrieval-time near-duplicate guard.
//
// Extracted from provider.ts on 2026-07-25 (Wave 1a) when LibraryProvider was
// deleted. The provider was structurally inert from 2026-06-22, when library
// went PULL-only via the MCP librarian — but `dedupeHits` outlived it, because
// the same chunk re-indexed under two sources should not consume two hit slots
// in any retrieval path.
//
// ⚠️ KNOWN GAP, deliberately not fixed here: the PRODUCTION dedup runs inside
// `scripts/ingest-library.ts`. This is a mirrored copy, and rag-dedup.test.ts
// exercises the copy. The test therefore proves the algorithm is correct, not
// that the shipped path uses it — if the two drift, the test stays green.
// Pointing the test at the real implementation is the actual fix.
// ============================================================

import { createHash } from "node:crypto";
import path from "node:path";
import type { LibraryHit } from "./service.js";

function normalizeChunkText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function dedupKey(hit: Pick<LibraryHit, "chunk_text" | "source">): string {
  const norm = normalizeChunkText(hit.chunk_text);
  const md5 = createHash("md5").update(norm).digest("hex");
  return `${md5}:${path.basename(hit.source)}`;
}

/** Keeps the first occurrence of each (normalised-text, basename) pair. */
export function dedupeHits<T extends Pick<LibraryHit, "chunk_text" | "source">>(
  hits: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of hits) {
    const key = dedupKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
