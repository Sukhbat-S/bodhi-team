// Generated from release-contract.ts by scripts/build-release-contract.mjs. Do not edit.

// scripts/lib/release-contract.ts
import { createHash } from "node:crypto";
var SHARED_ROOTS = [
  "apps/dashboard/",
  "apps/server/",
  "integrations/codex-plugin/bodhi/",
  "packages/core/",
  "packages/db/",
  "packages/library/",
  "packages/mcp-server/",
  "packages/memory/",
  "packages/scheduler/",
  "packages/verification/"
];
var SHARED_SKILL_ROOTS = [
  "templates/personal/skills/workflow-discovery/",
  "templates/personal/skills/existing-system-adoption/",
  "templates/personal/skills/operational-debugging/",
  "templates/personal/skills/component-driven-ui/",
  "templates/personal/skills/skill-behavior-evaluation/",
  "templates/personal/skills/skill-evolution/",
  "templates/personal/skills/accessibility-audit/",
  "templates/personal/skills/graphic-design-production/",
  "templates/personal/skills/information-design-review/",
  "templates/personal/skills/research-chain/",
  "templates/personal/skills/visual-system-review/",
  "templates/personal/skills/verify-by-emission/",
  "templates/personal/skills/session-save/",
  "templates/personal/skills/session-start/"
];
var SHARED_FILES = /* @__PURE__ */ new Set([
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
  "scripts/build-release-contract.mjs",
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
  "packages/memory/src/evals/runner.ts"
]);
var PRIVATE_ROOTS = [
  ".bodhi/",
  "backups/",
  "configs/persona/",
  "data/",
  "exports/",
  "onboarding/",
  "profiles/"
];
var PRIVATE_SEGMENTS = /* @__PURE__ */ new Set([
  ".bodhi",
  "backups",
  "data",
  "exports",
  "onboarding",
  "persona",
  "profiles",
  "secrets"
]);
var PRIVATE_BASENAMES = /* @__PURE__ */ new Set([
  ".env",
  "auth.json",
  "credentials.json",
  "secrets.json"
]);
var GATED_SEGMENTS = /* @__PURE__ */ new Set([
  ".vercel",
  "coverage",
  "dist",
  "evals",
  "node_modules"
]);
var GATED_BASENAMES = /* @__PURE__ */ new Set([
  "SOUL.md"
]);
var SHA256 = /^[0-9a-f]{64}$/;
var COMMIT = /^[0-9a-f]{40}$/;
var VERSION = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
var PLATFORMS = /* @__PURE__ */ new Set(["darwin-arm64", "darwin-x64", "win32-x64", "win32-arm64"]);
var RETIRED_AUTOMATIC_MIGRATION_IDS = /* @__PURE__ */ new Set([
  "apply-active-sessions-current-file-since",
  "apply-conversation-source-event",
  "apply-session-messages-delivered-to",
  "apply-session-messages-queue-cols",
  "apply-token-attribution-and-index",
  "apply-trades"
]);
function isAutomaticPersonalMigration(id) {
  return !RETIRED_AUTOMATIC_MIGRATION_IDS.has(id);
}
var OWNER_NEUTRAL_FORBIDDEN_CONTENT = [
  /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])/
];
function ownerNeutralContentError(bytes) {
  if (createHash("sha256").update(bytes).digest("hex") === "8a5ea8da5a293a1eea86d8aa8820bafc9808db079f325b97783d78796fd6a2d8") return null;
  if (bytes.includes(0)) return null;
  const text = bytes.toString("utf8");
  const matched = OWNER_NEUTRAL_FORBIDDEN_CONTENT.find((pattern) => pattern.test(text));
  return matched ? matched.source : null;
}
function normalizeRepositoryPath(input) {
  if (!input || input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) return null;
  const segments = input.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments.join("/");
}
function keysAre(value, expected) {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}
function classifyReleasePath(input) {
  const path = normalizeRepositoryPath(input);
  if (!path) return "private";
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const segments = path.split("/");
  if (SHARED_FILES.has(path)) return "shared";
  if (PRIVATE_BASENAMES.has(basename) || basename.startsWith(".env.") || /\.(?:db|sqlite|sqlite3|pem|key)$/i.test(basename) || PRIVATE_ROOTS.some((root) => path.startsWith(root)) || segments.some((segment) => PRIVATE_SEGMENTS.has(segment.toLowerCase()))) return "private";
  if (GATED_BASENAMES.has(basename) || basename.endsWith(".tsbuildinfo") || /\.(?:test|spec)\.[^.]+$/i.test(basename) || segments.some((segment) => GATED_SEGMENTS.has(segment.toLowerCase()))) return "gated";
  if (SHARED_ROOTS.some((root) => path.startsWith(root)) || SHARED_SKILL_ROOTS.some((root) => path.startsWith(root))) return "shared";
  return "gated";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validatePersonalReleaseManifest(value) {
  const errors = [];
  if (!isRecord(value)) return ["manifest must be an object"];
  if (!keysAre(value, ["contractVersion", "releaseVersion", "sourceCommit", "sourceDirty", "compatibility", "artifacts", "migrations", ...value.contractVersion === 2 ? ["schemaPlan"] : []])) {
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
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      errors.push("compatibility schema range must be non-negative and ordered");
    }
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    errors.push("artifacts must be a non-empty array");
  } else {
    const seen = /* @__PURE__ */ new Set();
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
    const seen = /* @__PURE__ */ new Set();
    const detailed = value.migrations.some((migration) => isRecord(migration) && ("order" in migration || "path" in migration || "checksum" in migration));
    const seenPaths = /* @__PURE__ */ new Set();
    const SHA2562 = /^[0-9a-f]{64}$/;
    for (const [index, migration] of value.migrations.entries()) {
      if (!isRecord(migration)) {
        errors.push(`migrations[${index}] must be an object`);
        continue;
      }
      if (!keysAre(migration, ["id", "classification", "rollback", "requiresOwnerApproval", ...detailed ? ["order", "path", "checksum"] : []])) errors.push(`migrations[${index}] has unknown or missing fields`);
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
        if (typeof migration.checksum !== "string" || !SHA2562.test(migration.checksum)) errors.push(`migrations[${index}].checksum must be lowercase SHA-256`);
      }
    }
    if (detailed && isRecord(value.compatibility) && Number.isInteger(value.compatibility.schemaFrom) && Number.isInteger(value.compatibility.schemaTo) && value.compatibility.schemaTo - value.compatibility.schemaFrom !== value.migrations.length) {
      errors.push("compatibility schema range must equal the ordered migration count");
    }
  }
  if (value.contractVersion === 2) {
    const plan = value.schemaPlan;
    const artifacts = new Map((Array.isArray(value.artifacts) ? value.artifacts : []).filter(isRecord).map((artifact) => [artifact.path, artifact.sha256]));
    if (!isRecord(plan) || !keysAre(plan, ["id", "source", "target", "rollback"]) || typeof plan.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(plan.id)) {
      errors.push("schemaPlan must contain an explicit baseline identity, source and target");
    } else {
      if (!isRecord(plan.rollback) || !keysAre(plan.rollback, ["path", "sha256"]) || plan.rollback.path !== "packages/db/src/migrations/next-era-outcomes-rollback.sql" || artifacts.get(plan.rollback.path) !== plan.rollback.sha256) errors.push("schemaPlan.rollback must match the immutable shipped recovery SQL");
      for (const role of ["source", "target"]) {
        const baseline = plan[role];
        if (!isRecord(baseline) || !keysAre(baseline, ["path", "sha256", "fingerprint"]) || typeof baseline.path !== "string" || !/^packages\/db\/bootstrap\/personal-v[12]\.sql$/.test(baseline.path) || typeof baseline.sha256 !== "string" || !SHA256.test(baseline.sha256) || typeof baseline.fingerprint !== "string" || !SHA256.test(baseline.fingerprint) || artifacts.get(baseline.path) !== baseline.sha256) errors.push(`schemaPlan.${role} is not bound to an immutable shipped baseline`);
      }
    }
    for (const migration of Array.isArray(value.migrations) ? value.migrations : []) {
      if (!isRecord(migration) || typeof migration.path !== "string" || artifacts.get(migration.path) !== migration.checksum) errors.push("migration must match a shipped artifact checksum");
    }
  }
  return errors;
}
export {
  OWNER_NEUTRAL_FORBIDDEN_CONTENT,
  RETIRED_AUTOMATIC_MIGRATION_IDS,
  classifyReleasePath,
  isAutomaticPersonalMigration,
  ownerNeutralContentError,
  validatePersonalReleaseManifest
};
