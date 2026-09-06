// ============================================================
// BODHI — Server Configuration
// Validates environment variables at startup
// ============================================================

import { z } from "zod";

/**
 * Minimum length for BODHI_API_TOKEN when auth is enabled. 32 chars matches the
 * `openssl rand -hex 32` recommendation in apiAuth.ts / .env.example (32 bytes →
 * 64 hex chars, so 32 is a conservative floor). A token shorter than this is a
 * hard config error — a weak secret on an engaged boundary is no boundary.
 */
export const MIN_API_TOKEN_LENGTH = 32;

/** True when the value is exactly the opt-in flag for the auth boundary. */
function authIsEnabled(v: string | undefined): boolean {
  return v === "1";
}

const baseEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Voyage AI (embeddings)
  VOYAGE_API_KEY: z.string().min(1, "VOYAGE_API_KEY is required"),

  PUBLIC_URL: z.string().optional(), // e.g. "https://bodhi.yourdomain.com"

  // API auth boundary (C1 / Phase ④ — fail-closed-by-default).
  // BODHI_API_AUTH="1" engages the bearer-token gate on mutating /api/* routes
  // (see middleware/apiAuth.ts). When enabled, BODHI_API_TOKEN MUST be a strong
  // secret — cross-validated below (refine) so "auth on, no/short secret" is a
  // hard config error, not a silently-weak boundary. Default (unset / not "1")
  // is a pure pass-through and stays byte-identical for single-user loopback dev.
  BODHI_API_AUTH: z.string().optional(),
  BODHI_API_TOKEN: z.string().optional(),

  // Bind host. Default 127.0.0.1 (loopback-only — the single-user assumption).
  // A non-loopback bind (e.g. 0.0.0.0) is a public exposure and is refused at
  // boot unless auth is enabled (see index.ts boot assertion). Kept in the
  // schema so a clone/fork can't set it without the value being validated.
  HOST: z.string().optional(),

  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Runtime
  TIMEZONE: z.string().default("Asia/Ulaanbaatar").refine((timeZone) => {
    try { new Intl.DateTimeFormat("en", { timeZone }).format(); return true; }
    catch { return false; }
  }, "TIMEZONE must be a supported IANA timezone"),
  BODHI_PROJECT_DIR: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  BODHI_OWNER_NAME: z.string().default("User"),
});

/**
 * Cross-field rule: if the auth boundary is enabled (BODHI_API_AUTH="1"), the
 * token MUST be present and at least MIN_API_TOKEN_LENGTH chars. "Auth on, no
 * secret" / "auth on, weak secret" are config errors — they would otherwise be
 * a boundary that only *looks* engaged (apiAuth.ts fail-closes at runtime, but
 * a clone should learn at boot, not on the first rejected request).
 *
 * This is additive: when auth is unset/off the refine is a no-op, so default
 * single-user dev parses exactly as before.
 */
const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (!authIsEnabled(env.BODHI_API_AUTH)) return;

  const token = env.BODHI_API_TOKEN ?? "";
  if (token.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BODHI_API_TOKEN"],
      message:
        'BODHI_API_AUTH="1" requires BODHI_API_TOKEN to be set (auth on, no secret is not a boundary)',
    });
    return;
  }
  if (token.length < MIN_API_TOKEN_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BODHI_API_TOKEN"],
      message: `BODHI_API_TOKEN must be at least ${MIN_API_TOKEN_LENGTH} chars when BODHI_API_AUTH="1" (use: openssl rand -hex 32)`,
    });
  }
});

export type Config = z.infer<typeof envSchema>;

/**
 * Pure parse: validate an env-shaped object and return a discriminated result.
 * Exported so tests can assert acceptance/rejection without triggering the
 * process.exit() side-effect that loadConfig() uses for fail-fast at boot.
 */
export function parseConfig(
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; config: Config }
  | { ok: false; issues: { path: string; message: string }[] } {
  const result = envSchema.safeParse(env);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

export function loadConfig(): Config {
  const result = parseConfig(process.env);

  if (!result.ok) {
    console.error("Configuration errors:");
    for (const issue of result.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.config;
}
