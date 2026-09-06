// ============================================================
// BODHI — memory coupling (Phase 33 B1, May 25, 2026)
//
// Sparse Γᵢⱼ matrix: cosine similarity between memory embeddings,
// thresholded at COUPLING_THRESHOLD. Used by MemorySynthesizer's
// decay+sustenance step.
//
// LMD metabolism.py:93-101 — the one structurally novel idea.
// ============================================================

export const COUPLING_THRESHOLD = 0.30;

// Wave 6 (Jul 2026) — scope-aware decay rates. The rate d is the per-run pull
// toward the neighbor-mean sustenance: newConf = conf·(1−d) + s̄·d, so d only
// sets convergence SPEED (steady state is s̄ either way). Choices:
//   foundational  → HALF rate, not exempt: a genuinely-wrong foundational
//                   memory must still be able to fade (demoteStaleFoundational
//                   + architect edits are the fast correction paths; a full
//                   exemption would make a bad foundational row immortal).
//   archived      → 1.5× rate: explicitly closed/parked, fade faster.
//   session-active → unchanged 0.05 baseline (also the no-scope legacy default,
//                   which keeps pre-Wave-6 callers/fixtures byte-identical).
export const DECAY_RATE_BY_SCOPE = {
  foundational: 0.025,
  "session-active": 0.05,
  archived: 0.075,
} as const;

export interface MemoryEmbedding {
  id: string;
  confidence: number;
  embedding: number[] | null;
  // §2.6 authority tier (Wave 6): drives the scope-aware decay rate above.
  // Optional — absent (legacy callers/tests) decays at the baseline rate.
  scope?: "foundational" | "session-active" | "archived";
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

/**
 * Apply decay-with-sustenance (scope-aware since Wave 6, Jul 2026):
 *   confidence_i_new = confidence_i_old * (1 - d_i)
 *                    + mean_j( Γ_ij * confidence_j_old ) * d_i
 * where d_i = DECAY_RATE_BY_SCOPE[scope_i] (0.05 baseline — the historical
 * 0.95/0.05 split — halved for foundational, 1.5× for archived).
 * Result clamped to [0, 1].
 */
export function applyDecayWithSustenance(
  memories: MemoryEmbedding[],
  coupling: Map<string, Map<string, number>>,
): Map<string, number> {
  const newConfidences = new Map<string, number>();
  const oldConfidences = new Map<string, number>(memories.map((m) => [m.id, m.confidence]));

  for (const m of memories) {
    let sustenance = 0;
    const neighbors = coupling.get(m.id);
    if (neighbors) {
      for (const [neighborId, similarity] of neighbors) {
        const neighborConf = oldConfidences.get(neighborId) ?? 0;
        sustenance += similarity * neighborConf;
      }
      // Normalize to the neighbor MEAN: the summed term is unbounded (grows with
      // neighbor count), so newConf saturated at the 1.0 clamp and the
      // write-if-changed guard skipped every row. Mean-normalizing bounds
      // sustenance to [0,1] → newConf ∈ [0.95, 1.0]. Guard count===0 → 0.
      const count = neighbors.size;
      sustenance = count > 0 ? sustenance / count : 0;
    }
    // Wave 6: scope-scaled rate. Unknown/absent scope → baseline (the ?? guard
    // covers rows whose scope string predates or escapes the enum).
    const d = DECAY_RATE_BY_SCOPE[m.scope ?? "session-active"] ?? DECAY_RATE_BY_SCOPE["session-active"];
    const newConf = m.confidence * (1 - d) + sustenance * d;
    newConfidences.set(m.id, Math.max(0, Math.min(1, newConf)));
  }

  return newConfidences;
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
