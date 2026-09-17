// ============================================================
// BODHI MCP Server — environment bootstrap.
// The harness MCP subprocess (Codex or Claude Code) reads the BODHI `.env`,
// keeping the localhost URL and bearer token out of harness configuration files.
//
// Import before ./client.js. The client also reads the token per request.
//
// Resolution order: BODHI_ENV_FILE, then BODHI_PROJECT_DIR / BODHI_ROOT /
// BODHI_PROJECT (a checkout directory), then `.env` in the working directory,
// then the generic ~/bodhi and ~/Documents/bodhi checkouts. Register the server
// with BODHI_ENV_FILE; an installed plugin runs from the harness cache, so only
// the explicit variable or a generic default location can find the file.
// ============================================================

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { homedir } from "node:os";
import * as path from "node:path";

interface ResolveEnvPathOptions {
  explicit?: string | null;
  projectDirectory?: string | null;
  cwd?: string;
  home?: string;
  exists?: (candidate: string) => boolean;
}

export function resolveEnvPath(options: ResolveEnvPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const exists = options.exists ?? existsSync;
  const explicit = options.explicit ?? process.env.BODHI_ENV_FILE?.trim();
  const projectDirectory = options.projectDirectory
    ?? process.env.BODHI_PROJECT_DIR?.trim()
    ?? process.env.BODHI_ROOT?.trim()
    ?? process.env.BODHI_PROJECT?.trim();
  if (explicit) return explicit;
  if (projectDirectory) return path.resolve(projectDirectory, ".env");
  const candidates = [
    path.resolve(cwd, ".env"),
    path.resolve(home, "bodhi/.env"),
    path.resolve(home, "Documents/bodhi/.env"),
  ];

  return candidates.find(exists) ?? candidates[0]!;
}

export const envPath = resolveEnvPath();
// Keep provider/database credentials out of the MCP process environment.
// The selected file is authoritative over stale inherited HTTP settings.
export function loadHttpEnvironment(file: string, env: NodeJS.ProcessEnv = process.env): void {
  if (existsSync(file)) {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 1024 * 1024) {
      throw new Error('BODHI MCP requires a private regular environment file');
    }
    const values = parseEnv(readFileSync(file, 'utf8'));
    env.BODHI_URL = values.BODHI_URL || `http://localhost:${values.BODHI_PORT || values.PORT || '4000'}`;
    if (values.BODHI_API_TOKEN) env.BODHI_API_TOKEN = values.BODHI_API_TOKEN;
    else delete env.BODHI_API_TOKEN;
  }
  const endpoint = new URL(env.BODHI_URL || `http://localhost:${env.BODHI_PORT || '4000'}`);
  if (!['http:', 'https:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('BODHI MCP requires a loopback endpoint');
  }
  env.BODHI_URL = endpoint.origin;
}
loadHttpEnvironment(envPath);
