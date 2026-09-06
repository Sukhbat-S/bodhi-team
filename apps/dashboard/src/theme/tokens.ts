// ============================================================
// BODHI — Design tokens (single source)
//
// Entity-type colors, lifted verbatim from the retired
// EntityGraphPage.tsx:91-97 (five) + the sixth (`product`)
// derived per ENTITIES-REDESIGN-DESIGN-JUN08.md §3.
//
// One source so the graph (EntityGraph2D), the filter pills,
// and any future legend all read the SAME palette — DESIGN.md
// §1.7. Convention throughout the surface: **fill = entity type,
// stroke = interaction state**. The two channels are now genuinely
// different hues — STATE_AMBER (#D4A76A) is reserved for the
// selection/hover ring, and NO type fill uses it (§1.4 fix). So a
// selected node's amber ring always reads distinct from its fill.
// ============================================================

/** Six entity-type fill colors. Keyed by `entity.type`.
 *  DESIGN.md is current authority. Palette provenance is recoverable with
 *  `git show 4eca578:docs/design/BODHI.dc.html`. The colors are quieter and
 *  lower-chroma than the v1 set so the
 *  amber state channel pops harder. topic stays the most-numerous quiet
 *  "field"; none of the six approaches STATE_AMBER (§1.4 invariant holds). */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  topic: "#8E887B", // warm pewter — densest cluster, recedes as the field
  project: "#8FA98F", // muted sage
  organization: "#7C8BB0", // dusk slate-blue
  person: "#9D8CC9", // muted violet
  place: "#A87E6B", // muted clay
  product: "#A39483", // taupe — distinct from pewter topic and amber state
};

/** Cooler-taupe fallback for `product` if the derived taupe muddles with topic. */
export const PRODUCT_TOKEN_FALLBACK = "#9C9488";

/** State channel — interaction strokes/rings, never a type fill. */
export const STATE_AMBER = "#D4A76A";

/** Resolve a type to its fill, with a neutral fallback for unknown types. */
export function entityColor(type: string): string {
  return ENTITY_TYPE_COLORS[type] ?? PRODUCT_TOKEN_FALLBACK;
}
