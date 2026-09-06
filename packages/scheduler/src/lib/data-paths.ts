import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Resolve the private per-owner data root at call time. The server loads .env
 * after module imports, so import-time constants silently ignore BODHI_HOME.
 */
export function resolveBodhiDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configured = env.BODHI_HOME?.trim();
  if (!configured) return join(home, ".bodhi");
  return isAbsolute(configured) ? configured : resolve(configured);
}

export function resolveSchedulerStatePath(env?: NodeJS.ProcessEnv, home?: string): string {
  return join(resolveBodhiDataRoot(env, home), "scheduler-state.json");
}

export function resolveSchedulerLockPath(env?: NodeJS.ProcessEnv, home?: string): string {
  return join(resolveBodhiDataRoot(env, home), "scheduler.lock");
}

export function resolveStalenessAlertStatePath(env?: NodeJS.ProcessEnv, home?: string): string {
  return join(resolveBodhiDataRoot(env, home), "staleness-alert-state.json");
}

export { resolveBackupDirectory } from "@seneca/core";
