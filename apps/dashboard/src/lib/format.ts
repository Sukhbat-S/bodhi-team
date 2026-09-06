// ============================================================
// BODHI — shared formatting helpers
//
// Lifted verbatim from AgentsPage.tsx (~lines 100-145) during the
// v2 rebuild (Wave 0). Behavior preserved exactly — including the
// cost-null honesty: "—" for null/zero cost, never a fabricated
// number.
// ============================================================

/** Relative time: "now", "12m", "3h", "5d", then "Jun 10". "—" for null/invalid. */
export function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h`;
  const day = Math.floor(diff / 86400000);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
