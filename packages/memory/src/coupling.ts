// ============================================================
// BODHI — memory coupling (Phase 33 B1, May 25, 2026)
//
// Sparse Γᵢⱼ matrix: cosine similarity between memory embeddings,
// thresholded at COUPLING_THRESHOLD.
//
// LMD metabolism.py:93-101 — the one structurally novel idea.
// ============================================================

export const COUPLING_THRESHOLD = 0.30;

export interface MemoryEmbedding {
  id: string;
  confidence: number;
  embedding: number[] | null;
}

/**
 * pgvector → number[]. postgres-js returns vector columns as the text form
 * "[0.1,0.2,...]" (valid JSON array syntax), NOT number[]. Feeding the raw
 * string into cosineSimilarity yields NaN, which silently zeroes the entire
 * sustenance term — the bug that left Phase 33 B1 dead on arrival. Returns null
 * on absence/parse failure so coupling skips the row instead of NaN-poisoning.
 */
export function parseEmbedding(raw: string | number[] | null | undefined): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Compute sparse coupling matrix. Returns Map<id, Map<id, similarity>>.
 * Symmetric (Γᵢⱼ = Γⱼᵢ). Self-pairs excluded.
 */
export function computeCoupling(memories: MemoryEmbedding[]): Map<string, Map<string, number>> {
  const coupling = new Map<string, Map<string, number>>();
  const withEmbeddings = memories.filter((m) => m.embedding && m.embedding.length > 0);

  for (let i = 0; i < withEmbeddings.length; i++) {
    const mi = withEmbeddings[i];
    if (!mi.embedding) continue;
    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const mj = withEmbeddings[j];
      if (!mj.embedding) continue;
      const sim = cosineSimilarity(mi.embedding, mj.embedding);
      if (sim >= COUPLING_THRESHOLD) {
        if (!coupling.has(mi.id)) coupling.set(mi.id, new Map());
        if (!coupling.has(mj.id)) coupling.set(mj.id, new Map());
        coupling.get(mi.id)!.set(mj.id, sim);
        coupling.get(mj.id)!.set(mi.id, sim);
      }
    }
  }

  return coupling;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
