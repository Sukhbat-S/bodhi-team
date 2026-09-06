import { mkdirSync } from "node:fs";
import { resolveBodhiPath, getBodhiHome } from "@seneca/core";

let initialized = false;

export function _resetProfile(): void {
  initialized = false;
}

/**
 * Retained as an explicit compatibility boundary for profile-aware callers.
 *
 * The Codex-native server uses Postgres for its live substrate. SQLite
 * profile state is historical archive material, so boot must never create,
 * open, migrate, or close `state.db`. Directory preparation remains here for
 * the older explicit profile tooling; archiving/restoration is a separate,
 * operator-invoked path and is never implicit during startup.
 */
export function initProfile(): void {
  if (initialized) return;
  const home = getBodhiHome();
  mkdirSync(home, { recursive: true });
  mkdirSync(resolveBodhiPath("memories"), { recursive: true });
  mkdirSync(resolveBodhiPath("skills"), { recursive: true });
  mkdirSync(resolveBodhiPath("sessions"), { recursive: true });
  mkdirSync(resolveBodhiPath("profiles"), { recursive: true });
  initialized = true;
}
