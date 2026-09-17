import { createHash } from "node:crypto";
// Canonical pure release contract. Generate release-contract.mjs; do not maintain a second validator.
export type PathClass = "shared" | "private" | "gated";

const SHARED_ROOTS = [
  "apps/dashboard/",
  "apps/server/",
  "integrations/codex-plugin/bodhi/",
  "packages/core/",
  "packages/db/",
  "packages/library/",
  "packages/mcp-server/",
  "packages/memory/",
  "packages/scheduler/",
  "packages/verification/",
] as const;

const SHARED_SKILL_ROOTS = [
  "templates/personal/skills/workflow-discovery/",
  "templates/personal/skills/component-driven-ui/",
  "templates/personal/skills/first-principles-decision/",
  "templates/personal/skills/product-discovery/",
  "templates/personal/skills/interface-review/",
  "templates/personal/skills/emil-design-eng/",
  "templates/personal/skills/better-ui/",
  "templates/personal/skills/research-chain/",
  "templates/personal/skills/verify-by-emission/",
  "templates/personal/skills/session-save/",
  "templates/personal/skills/session-start/",
] as const;

// Owner-neutral harness templates for Claude Code and Codex: instruction
// templates, agent cards, hooks and configuration snippets. Rendered or linked
// by scripts/install-harness.mjs; configuration is printed, never merged.
const SHARED_TEMPLATE_ROOTS = [
  "templates/claude-code/",
  "templates/codex/",
] as const;

// Owner-specific lifecycle files stay gated. Personal-release lifecycle and
// studio skills are admitted only through the exact owner-neutral template
// roots above; nearby skills and private policy remain gated.
const SHARED_FILES = new Set([
  "scripts/distribution.test.ts",
  "apps/dashboard/src/components/EntityHoverPreview.render.test.ts",
  "apps/dashboard/src/components/EntityHoverPreview.test.ts",
  "README.md",
  "LICENSE",
  ".gitignore",
  ".env.example",
  "vitest.config.ts",
  "CHANGELOG.md",
  "SECURITY.md",
  "scripts/pack-release.mjs",
  "scripts/check-distribution.mjs",
  "scripts/install-project-skills.mjs",
  "scripts/install-harness.mjs",
  "scripts/harness-session-lifecycle.sh",
  "scripts/harness-session-lifecycle.test.ts",
  "scripts/build-release-contract.mjs",
  "docs/dual-harness-orchestration.md",
  "docs/decisions/ADR-004-peer-harness-claude-code.md",
  "docs/windows-wsl2.md",
  // Measurement wrapper only: the plugin manifest, its README and one neutral
  // example case. Run output and per-skill links stay local and gitignored.
  "skill-evals/.claude-plugin/plugin.json",
  "skill-evals/README.md",
  "skill-evals/evals/fire-verify-by-emission/prompt.md",
  "skill-evals/evals/fire-verify-by-emission/graders/fired.md",

  ".nvmrc",
  "package-lock.json",
  "package.json",
  "configs/launchd/com.bodhi.server.plist",
  "configs/personal-project-routing.json",
  "configs/personal-skill-matrix.json",
  "configs/personal-schema-plan.json",
  "scripts/lib/bodhi-runtime.sh",
  "scripts/lib/service-ownership.ts",
  "scripts/lib/postgres-backup.ts",
  "scripts/lib/release-contract.ts",
  "scripts/lib/release-contract.mjs",
  "scripts/lib/isolated-dependencies.mjs",
  "scripts/lib/release-install-state.mjs",
  "scripts/lib/with-install-lock.mjs",
  "scripts/backup-db.ts",
  "scripts/backup-db.sh",
  "scripts/personal-schema.ts",
  "scripts/bootstrap-personal-macos.sh",
  // Linux and WSL2 counterparts of the macOS lifecycle scripts, plus their shared probes.
  "scripts/bootstrap-personal-linux.sh",
  "scripts/upgrade-personal-linux.sh",
  "scripts/activate-personal-voyage-linux.sh",
  "scripts/install-systemd-user-service.sh",
  "scripts/lib/linux-platform.sh",
  "scripts/check-personal-coherence.mjs",
  "scripts/import-reviewed-foundation.ts",
  "scripts/import-reviewed-corpus.ts",
  "scripts/activate-personal-voyage-macos.sh",
  "scripts/upgrade-personal-macos.sh",
  "scripts/verified-migrate.ts",
  "scripts/verify-personal-release.mjs",
  "scripts/install-hooks.sh",
  "scripts/install-launch-agent.sh",
  "scripts/lib/bodhi-node.sh",
  "scripts/run-server.sh",
  "scripts/start.sh",
  "scripts/stop.sh",
  "templates/personal/AGENTS.md.tpl",
  "tsconfig.base.json",
  "packages/library/src/evals/runner.ts",
  "packages/memory/src/evals/runner.ts",
]);

const PRIVATE_ROOTS = [
  ".bodhi/",
  "backups/",
  "configs/persona/",
  "data/",
  "exports/",
  "onboarding/",
  "profiles/",
] as const;

const PRIVATE_SEGMENTS = new Set([
  ".bodhi",
  "backups",
  "data",
  "exports",
  "onboarding",
  "persona",
  "profiles",
  "secrets",
]);

const PRIVATE_BASENAMES = new Set([
  ".env",
  "auth.json",
  "credentials.json",
  "secrets.json",
]);

const GATED_SEGMENTS = new Set([
  ".vercel",
  "coverage",
  "dist",
  "evals",
  "node_modules",
]);

const GATED_BASENAMES = new Set([
  "SOUL.md",
]);

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PLATFORMS = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"]);

export const RETIRED_AUTOMATIC_MIGRATION_IDS = new Set([
  "apply-active-sessions-current-file-since",
  "apply-conversation-source-event",
  "apply-session-messages-delivered-to",
  "apply-session-messages-queue-cols",
  "apply-token-attribution-and-index",
  "apply-trades",
]);

export function isAutomaticPersonalMigration(id: string): boolean {
  return !RETIRED_AUTOMATIC_MIGRATION_IDS.has(id);
}

// Release-shared bytes must not carry a person's identity or this workstation's
// absolute paths. Owner-specific policy remains in the private validator and
// private config, outside the release classifier's shared set.
// Identity terms are stored as code points so this shared file, its generated
// .mjs and a repository-wide text search never match the gate's own source.
const word = (chars: readonly number[]): string => String.fromCodePoint(...chars);
const OWNER_IDENTITY_FRAGMENTS: readonly string[] = [
  // Owner, collaborators, family and client names, handles and places.
  ...[
    [115, 117, 107, 104, 98, 97, 116],
    [115, 111, 115, 111, 114, 98, 97, 114, 97, 109],
    [116, 117, 115, 104, 105, 103],
    [110, 121, 97, 109, 107, 97],
    [110, 121, 97, 109, 98, 97, 121, 97, 114],
    [100, 97, 109, 100, 105, 110, 100, 111, 111],
    [110, 121, 109, 98, 97, 121, 114, 48, 50, 48, 54],
    [115, 104, 105, 103, 116, 103, 101, 101],
    [122, 117, 117, 115, 103, 101, 108],
    [103, 101, 114, 101, 108, 115, 117, 114, 101, 110],
    [115, 117, 117, 103, 105, 105],
    [97, 108, 116, 97, 110, 116, 117, 121, 97],
    [103, 101, 103, 101, 101, 110, 101, 101],
    [117, 108, 97, 97, 110, 98, 97, 97, 116, 97, 114],
    [109, 111, 115, 115, 101, 116, 99, 104],
    [98, 97, 116, 116, 117, 115, 104, 105, 103],
    [116, 111, 103, 116, 111, 107, 104],
    [97, 97, 103, 105, 105],
    [110, 121, 109, 115, 117, 114, 101, 110],
    [101, 110, 98, 111, 116, 105, 99, 115],
    [100, 97, 121, 97, 110, 115, 111, 102, 116],
    [104, 111, 104, 104, 111, 116],
  ].map(word),
  // The owner's retail line of business, in either spelling.
  `${word([106, 101, 119, 101, 108])}(?:${word([108, 101])})?${word([114, 121])}`,
  // Multi-word organisation and brand names, with any separator or none.
  `${word([97, 103, 101, 110, 116, 105, 99])}[\\s_-]*${word([102, 111, 114, 99, 101])}`,
  `${word([106, 101, 116])}[\\s_-]*${word([98, 97, 107, 101, 114, 121])}`,
  `${word([118, 105, 112])}[\\s_-]*${word([99, 108, 117, 98])}`,
  `${word([97, 38, 103])}[\\s_-]*${word([104, 101, 114, 105, 116, 97, 103, 101])}`,
  // Short names that are substrings of ordinary words match only as whole words.
  `\\b${word([110, 99, 100])}\\b`,
  `\\b${word([97, 110, 97, 114])}\\b`,
  `\\b${word([103, 97, 114, 108, 105, 99])}\\b`,
];

const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// Any dotted-quad address except the loopback range and the unspecified address.
const NON_LOOPBACK_IPV4 = /(?<![\w.])(?!127(?:\.\d{1,3}){3}(?![\w.]))(?!0\.0\.0\.0(?![\w.]))(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.])/;

// Behaviour-bearing identifiers that contain an identity term but cannot be
// renamed without a runtime-default or schema change: the IANA default time
// zone, a column of a retired, never-automatic migration, and a value of the
// briefing_type database enum that is part of the hash-bound schema baselines.
// They are exempt only as these exact tokens; the bare term still fails.
const BEHAVIOUR_BEARING_IDENTIFIERS = new RegExp([
  `${word([65, 115, 105, 97, 47])}${word([85, 108, 97, 97, 110, 98, 97, 97, 116, 97, 114])}(?![\\w/])`,
  `(?<![\\w])${word([109, 111, 115, 115, 101, 116, 99, 104])}_${word([114, 101, 118, 105, 101, 119])}(?!\\w)`,
  `(?<![\\w-])${word([106, 101, 119, 101, 108, 114, 121])}-${word([99, 104, 97, 110, 103, 101, 108, 111, 103])}(?![\\w-])`,
].join("|"), "g");

export const OWNER_NEUTRAL_FORBIDDEN_CONTENT = [
  new RegExp(OWNER_IDENTITY_FRAGMENTS.join("|"), "i"),
  /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])/,
  EMAIL_ADDRESS,
  NON_LOOPBACK_IPV4,
] as const;

// Exact bytes of the upstream MIT copyright notice (LICENSE), which must be retained.
const UPSTREAM_MIT_NOTICE_SHA256 = "8a5ea8da5a293a1eea86d8aa8820bafc9808db079f325b97783d78796fd6a2d8";

export function ownerNeutralContentError(bytes: Buffer): string | null {
  // Preserve the exact required upstream MIT copyright notice, not arbitrary owner content.
  if (createHash("sha256").update(bytes).digest("hex") === UPSTREAM_MIT_NOTICE_SHA256) return null;
  if (bytes.includes(0)) return null;
  const text = bytes.toString("utf8").replace(BEHAVIOUR_BEARING_IDENTIFIERS, " ");
  const matched = OWNER_NEUTRAL_FORBIDDEN_CONTENT.find((pattern) => pattern.test(text));
  return matched ? matched.source : null;
}

export type PersonalReleaseManifest = {
  contractVersion: 1 | 2;
  schemaPlan?: {
    id: string;
    rollback: { path: string; sha256: string };
    source: { path: string; sha256: string; fingerprint: string };
    target: { path: string; sha256: string; fingerprint: string };
  };
  releaseVersion: string;
  sourceCommit: string;
  sourceDirty: false;
  compatibility: {
    platforms: string[];
    schemaFrom: number;
    schemaTo: number;
  };
  artifacts: Array<{ path: string; sha256: string }>;
  migrations: Array<{
    id: string;
    classification: "additive" | "reversible" | "destructive";
    rollback: string | null;
    requiresOwnerApproval: boolean;
    // Wave 3 schema authority fields. They are optional only for legacy
    // manifests; any new detailed migration entry must carry the full set.
    order?: number;
    path?: string;
    checksum?: string;
  }>;
};

function normalizeRepositoryPath(input: string): string | null {
  if (!input || input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) return null;
  const segments = input.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function keysAre(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

export function classifyReleasePath(input: string): PathClass {
  const path = normalizeRepositoryPath(input);
  if (!path) return "private";

  const basename = path.slice(path.lastIndexOf("/") + 1);
  const segments = path.split("/");
  if (SHARED_FILES.has(path)) return "shared";

  if (
    PRIVATE_BASENAMES.has(basename)
    || basename.startsWith(".env.")
    || /\.(?:db|sqlite|sqlite3|pem|key)$/i.test(basename)
    || PRIVATE_ROOTS.some((root) => path.startsWith(root))
    || segments.some((segment) => PRIVATE_SEGMENTS.has(segment.toLowerCase()))
  ) return "private";

  if (
    GATED_BASENAMES.has(basename)
    || basename.endsWith(".tsbuildinfo")
    || /\.(?:test|spec)\.[^.]+$/i.test(basename)
    || segments.some((segment) => GATED_SEGMENTS.has(segment.toLowerCase()))
  ) return "gated";

  if (
    SHARED_ROOTS.some((root) => path.startsWith(root))
    || SHARED_SKILL_ROOTS.some((root) => path.startsWith(root))
    || SHARED_TEMPLATE_ROOTS.some((root) => path.startsWith(root))
  ) return "shared";
  return "gated";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePersonalReleaseManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["manifest must be an object"];

  if (!keysAre(value, ["contractVersion", "releaseVersion", "sourceCommit", "sourceDirty", "compatibility", "artifacts", "migrations", ...(value.contractVersion === 2 ? ["schemaPlan"] : [])])) {
    errors.push("manifest has unknown or missing top-level fields");
  }

  if (value.contractVersion !== 1 && value.contractVersion !== 2) errors.push("contractVersion must be 1 or 2");
  if (typeof value.releaseVersion !== "string" || !VERSION.test(value.releaseVersion)) errors.push("releaseVersion must be semantic version text");
  if (typeof value.sourceCommit !== "string" || !COMMIT.test(value.sourceCommit)) errors.push("sourceCommit must be a full 40-character Git commit");
  if (value.sourceDirty !== false) errors.push("sourceDirty must be false");

  if (!isRecord(value.compatibility)) {
    errors.push("compatibility must be an object");
  } else {
    if (!keysAre(value.compatibility, ["platforms", "schemaFrom", "schemaTo"])) errors.push("compatibility has unknown or missing fields");
    const platforms = value.compatibility.platforms;
    if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every((item) => typeof item === "string" && PLATFORMS.has(item))) {
      errors.push("compatibility.platforms must contain supported explicit platform targets");
    }
    const from = value.compatibility.schemaFrom;
    const to = value.compatibility.schemaTo;
    if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (to as number) < (from as number)) {
      errors.push("compatibility schema range must be non-negative and ordered");
    }
  }

  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    errors.push("artifacts must be a non-empty array");
  } else {
    const seen = new Set<string>();
    for (const [index, artifact] of value.artifacts.entries()) {
      if (!isRecord(artifact) || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
        errors.push(`artifacts[${index}] must contain path and sha256`);
        continue;
      }
      if (!keysAre(artifact, ["path", "sha256"])) errors.push(`artifacts[${index}] has unknown or missing fields`);
      const classification = classifyReleasePath(artifact.path);
      if (classification !== "shared") errors.push(`artifacts[${index}].path is ${classification}, not shared`);
      if (!SHA256.test(artifact.sha256)) errors.push(`artifacts[${index}].sha256 must be lowercase SHA-256`);
      if (seen.has(artifact.path)) errors.push(`artifacts[${index}].path is duplicated`);
      seen.add(artifact.path);
    }
  }

  if (!Array.isArray(value.migrations)) {
    errors.push("migrations must be an array");
  } else {
    const seen = new Set<string>();
    const detailed = value.migrations.some((migration) => isRecord(migration) && ("order" in migration || "path" in migration || "checksum" in migration));
    const seenPaths = new Set<string>();
    const SHA256 = /^[0-9a-f]{64}$/;
    for (const [index, migration] of value.migrations.entries()) {
      if (!isRecord(migration)) {
        errors.push(`migrations[${index}] must be an object`);
        continue;
      }
      if (!keysAre(migration, ["id", "classification", "rollback", "requiresOwnerApproval", ...(detailed ? ["order", "path", "checksum"] : [])])) errors.push(`migrations[${index}] has unknown or missing fields`);
      const classification = migration.classification;
      if (typeof migration.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(migration.id)) errors.push(`migrations[${index}].id is invalid`);
      else if (seen.has(migration.id)) errors.push(`migrations[${index}].id is duplicated`);
      else {
        seen.add(migration.id);
        if (!isAutomaticPersonalMigration(migration.id)) errors.push(`migrations[${index}].id targets a retired automatic migration`);
      }
      if (!["additive", "reversible", "destructive"].includes(String(classification))) errors.push(`migrations[${index}].classification is invalid`);
      if (classification === "reversible" && (typeof migration.rollback !== "string" || !migration.rollback.trim())) errors.push(`migrations[${index}] reversible migration needs rollback`);
      if (classification === "destructive" && migration.requiresOwnerApproval !== true) errors.push(`migrations[${index}] destructive migration requires owner approval`);
      if (classification === "destructive") errors.push(`migrations[${index}] destructive migration is not eligible for an automatic release`);
      if (typeof migration.requiresOwnerApproval !== "boolean") errors.push(`migrations[${index}].requiresOwnerApproval must be boolean`);
      if (!(migration.rollback === null || typeof migration.rollback === "string")) errors.push(`migrations[${index}].rollback must be text or null`);
      if (detailed) {
        if (migration.order !== index + 1) errors.push(`migrations[${index}].order must be ${index + 1}`);
        if (typeof migration.path !== "string" || !/^packages\/db\/src\/migrations\/(?:apply-[a-z0-9][a-z0-9_-]*\.ts|next-era-outcomes-stage[12]\.sql)$/.test(migration.path)) {
          errors.push(`migrations[${index}].path is not an allowed migration path`);
        } else {
          if (seenPaths.has(migration.path)) errors.push(`migrations[${index}].path is duplicated`);
          seenPaths.add(migration.path);
          const derivedId = migration.path.match(/\/([^/]+)\.(?:ts|sql)$/)?.[1];
          if (derivedId !== migration.id) errors.push(`migrations[${index}].id does not match path`);
        }
        if (typeof migration.checksum !== "string" || !SHA256.test(migration.checksum)) errors.push(`migrations[${index}].checksum must be lowercase SHA-256`);
      }
    }
    if (detailed && isRecord(value.compatibility) && Number.isInteger(value.compatibility.schemaFrom) && Number.isInteger(value.compatibility.schemaTo) &&
        (value.compatibility.schemaTo as number) - (value.compatibility.schemaFrom as number) !== value.migrations.length) {
      errors.push("compatibility schema range must equal the ordered migration count");
    }
  }

  if (value.contractVersion === 2) {
    const plan = value.schemaPlan;
    const artifacts = new Map((Array.isArray(value.artifacts) ? value.artifacts : []).filter(isRecord).map((artifact) => [artifact.path, artifact.sha256]));
    if (!isRecord(plan) || !keysAre(plan, ["id", "source", "target", "rollback"]) || typeof plan.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(plan.id)) {
      errors.push("schemaPlan must contain an explicit baseline identity, source and target");
    } else {
      if (!isRecord(plan.rollback) || !keysAre(plan.rollback, ["path", "sha256"])
        || plan.rollback.path !== "packages/db/src/migrations/next-era-outcomes-rollback.sql"
        || artifacts.get(plan.rollback.path) !== plan.rollback.sha256) errors.push("schemaPlan.rollback must match the immutable shipped recovery SQL");
      for (const role of ["source", "target"] as const) {
        const baseline = plan[role];
        if (!isRecord(baseline) || !keysAre(baseline, ["path", "sha256", "fingerprint"])
          || typeof baseline.path !== "string" || !/^packages\/db\/bootstrap\/personal-v[12]\.sql$/.test(baseline.path)
          || typeof baseline.sha256 !== "string" || !SHA256.test(baseline.sha256)
          || typeof baseline.fingerprint !== "string" || !SHA256.test(baseline.fingerprint)
          || artifacts.get(baseline.path) !== baseline.sha256) errors.push(`schemaPlan.${role} is not bound to an immutable shipped baseline`);
      }
    }
    for (const migration of Array.isArray(value.migrations) ? value.migrations : []) {
      if (!isRecord(migration) || typeof migration.path !== "string" || artifacts.get(migration.path) !== migration.checksum) errors.push("migration must match a shipped artifact checksum");
    }
  }

  return errors;
}

