import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_HOME = join(homedir(), ".bodhi");
let warned = false;

export function _resetWarningCache(): void {
  warned = false;
}

export function getBodhiHome(): string {
  const env = process.env.BODHI_HOME;
  if (env) return env;
  if (process.env.BODHI_PROFILE && !warned) {
    warned = true;
    console.warn(
      `[bodhi] BODHI_PROFILE=${process.env.BODHI_PROFILE} is set but BODHI_HOME is not. ` +
        `Falling back to ${DEFAULT_HOME}; profile state will NOT be isolated. ` +
        `Set BODHI_HOME=${DEFAULT_HOME}/profiles/${process.env.BODHI_PROFILE} to fix.`,
    );
  }
  return DEFAULT_HOME;
}

export function resolveBodhiPath(...segments: string[]): string {
  return join(getBodhiHome(), ...segments);
}

/** One shared continuity-backup root for the producer, doctor and liveness reads. */
export function resolveBackupDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.BODHI_BACKUP_ROOT?.trim()) return resolve(env.BODHI_BACKUP_ROOT.trim());
  if (env.BODHI_HOME?.trim()) return join(resolve(env.BODHI_HOME.trim()), "backups");
  return join(home, "bodhi-backups");
}
