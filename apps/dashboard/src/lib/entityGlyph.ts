// ============================================================
// entityGlyph — categorical signal without color
// ============================================================
//
// M3 (May 9 late evening). The original TYPE_DOT used 5 bright
// Tailwind hues for the 5 entity types — violated §1.4 single accent
// + §9 anti-patterns. @bodhi-design caught it; we replaced with a
// uniform muted dot. The owner then noted: the categorical signal was
// doing real scan work; deletion was overcorrection.
//
// Glyphs solve the same problem in a different dimension. Single ink-
// tone (stone-500). Shape carries category. All five visually
// distinguishable at scan distance.
//
//   ◆ person       (filled diamond — gravity, emotional weight)
//   ▣ project      (filled square — structure, codebase)
//   ◇ organization (open diamond — outside, neighbor)
//   ○ topic        (open circle — abstract, concept)
//   △ place        (open triangle — locality)
//
// Used by EntityActivityRibbon, EntityListFallback rows,
// and EntityThread header.

export const ENTITY_GLYPH: Record<string, string> = {
  person: "◆",
  project: "▣",
  organization: "◇",
  topic: "○",
  place: "△",
};

export function glyphFor(type: string | null | undefined): string {
  if (!type) return "·";
  return ENTITY_GLYPH[type] ?? "·";
}
