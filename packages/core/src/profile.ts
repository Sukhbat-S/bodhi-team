import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getBodhiHome, resolveBodhiPath } from "./home.js";

const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

export function getProfilePath(name: string): string {
  if (!VALID_NAME.test(name)) {
    throw new Error(
      `invalid profile name: ${JSON.stringify(name)} (must match ${VALID_NAME})`,
    );
  }
  return resolveBodhiPath("profiles", name);
}

export function profileExists(name: string): boolean {
  return existsSync(getProfilePath(name));
}

export function listProfiles(): string[] {
  const dir = resolveBodhiPath("profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => {
    try {
      return statSync(join(dir, n)).isDirectory();
    } catch {
      return false;
    }
  });
}

export function isDefaultManaged(): boolean {
  return existsSync(join(getBodhiHome(), ".managed"));
}
