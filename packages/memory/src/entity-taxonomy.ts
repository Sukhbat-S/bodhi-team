// ============================================================
// Entity Taxonomy — two-level fixed classification (Phase C)
// ============================================================
//
// Layer 1 (type, in entities.type): the 5-bucket enum that already
// exists — person, project, topic, organization, place. Stays.
//
// Layer 2 (subtype, in entities.subtype): a fixed-vocabulary second
// level that fits a personal owner's actual life. Subtype is OPTIONAL — the
// extractor is allowed to set it null when uncertain, and the backfill
// only writes subtypes it can classify with high confidence.
//
// Why fixed vocabulary (not free-form):
//   - Free-form re-derives the duplicate problem at the subtype level
//     ("sister" vs "blood-sister" vs "sis").
//   - A bounded enum lets the FilterDrawer render a stable cascade.
//   - The extractor prompt can list the menu and ask the model to
//     pick — better than asking it to invent.
//
// Adding a subtype: append to the relevant array, write a one-line
// description in SUBTYPE_DESCRIPTIONS, ship. No migration needed.

export const ENTITY_TAXONOMY = {
  person: ["sister", "family", "client", "friend", "mentor", "advisor", "stranger"],
  project: ["brand", "codebase", "creative", "research", "side-bet"],
  organization: ["supplier", "platform", "media", "school", "venue", "financial", "government"],
  topic: ["concept", "skill", "domain"],
  place: ["city", "site", "country"],
} as const;

export type EntityTypeKey = keyof typeof ENTITY_TAXONOMY;
export type EntitySubtype = (typeof ENTITY_TAXONOMY)[EntityTypeKey][number];

// Per-subtype hints fed into the extractor prompt so the model picks the
// right bucket. The descriptions stay owner-neutral so the release does not
// bias extraction toward another person's relationships or projects.
export const SUBTYPE_DESCRIPTIONS: Record<string, string> = {
  // person
  sister: "The owner's sister.",
  family: "Mother, father, aunt, uncle, cousin — blood family that isn't a sister.",
  client: "Paying customer or commercial counterparty.",
  friend: "Personal friend, peer, social tie.",
  mentor: "Senior professional or teacher the owner actively learns from.",
  advisor: "Trusted external voice consulted occasionally; not a daily relationship.",
  stranger: "Public figure, account, or person mentioned but not personally known.",

  // project
  brand: "Customer-facing brand owned or operated by the owner or their family.",
  codebase: "Software project the owner builds or maintains.",
  creative: "Design, content, or artistic project (videos, briefings, essays).",
  research: "Time-bounded investigation or experiment (trading sprint, AI patterns).",
  "side-bet": "Speculative or pre-commercial project (gaming-center, food-stall).",

  // organization
  supplier: "Vendor providing goods or materials (a packaging supplier, a wholesale distributor).",
  platform: "Tech platform or service (Vercel, Supabase, Anthropic, CapCut, Atlassian).",
  media: "News, publication, or content platform (X, TikTok, Telegram).",
  school: "Educational institution.",
  venue: "Physical location for commerce or events (Соёолж молл).",
  financial: "Bank, fintech, payment processor, or other financial institution (Хаан банк, Mongol Bank, QPay, Stripe).",
  government: "Government body, ministry, regulator, or public agency.",

  // topic
  concept: "Abstract idea or framework (heliocentric design, past-as-inhabitable).",
  skill: "Capability being learned or applied (Mongolian writing, embeddings).",
  domain: "Field of work (e-commerce, marketing, logistics).",

  // place
  city: "City (Tokyo, Berlin).",
  site: "Specific physical location, not commercial in itself (a neighborhood, a landmark).",
  country: "Country (Mongolia, China).",
};

/** Validate that a subtype is allowed for the given type. */
export function isValidSubtype(type: string, subtype: string | null | undefined): boolean {
  if (!subtype) return true; // null is always valid
  const allowed = ENTITY_TAXONOMY[type as EntityTypeKey];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(subtype);
}

/** Render the taxonomy as a prompt-ready menu for the extractor. */
export function renderTaxonomyMenu(): string {
  const lines: string[] = ["Available entity types and subtypes:"];
  for (const [type, subtypes] of Object.entries(ENTITY_TAXONOMY)) {
    lines.push(`- ${type}:`);
    for (const sub of subtypes) {
      const desc = SUBTYPE_DESCRIPTIONS[sub] ?? "";
      lines.push(`    - ${sub} — ${desc}`);
    }
  }
  lines.push("");
  lines.push("If uncertain about subtype, leave it null. Type is required.");
  return lines.join("\n");
}
