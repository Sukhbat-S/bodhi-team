import type { ProjectRoute } from "./project-routing.js";

/** Resolve only declared aliases; an explicit unknown namespace keeps its identity. */
export function canonicalProjectKey(raw: string, routes: readonly ProjectRoute[]): string {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 500 || /[\x00-\x1f\x7f]/.test(raw)) {
    throw new Error("projectKey must be a nonempty namespace of at most 500 characters without control characters");
  }
  const value = raw.trim();
  const lookup = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en-US").trim();
  const matches = routes.filter((route) => [route.key, ...route.aliases, ...route.nativeLabels, ...route.pathLeaves]
    .some((alias) => lookup(alias) === lookup(value)));
  if (new Set(matches.map((route) => route.key)).size > 1) throw new Error("project alias is ambiguous");
  return matches[0]?.key ?? value;
}
