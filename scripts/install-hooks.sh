#!/usr/bin/env bash
# ============================================================
# BODHI — install git hooks
#
# Installs a thin pre-push wrapper around the Codex-native architecture,
# build, and repository-hygiene checks.
#
# Explicit opt-in only. Preserve any existing user hook unchanged.
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-path hooks 2>/dev/null || true)"
HOOK_FILE="${HOOK_DIR}/pre-push"

# Skip cleanly if not in a git checkout (e.g., npm-install in a tarball).
if [ -z "$HOOK_DIR" ]; then
  echo "[install-hooks] not a git checkout — skipping"
  exit 0
fi

# Sealed personal releases intentionally omit publisher-only repository checks.
# Do not install a hook that references files the owner-neutral package does not
# contain.
if [ ! -f "${REPO_ROOT}/scripts/pre-push-checklist.ts" ] || [ ! -f "${REPO_ROOT}/scripts/desk-check.ts" ]; then
  echo "[install-hooks] publisher checks absent in personal release — skipping"
  exit 0
fi

mkdir -p "${HOOK_DIR}"
if [ -e "$HOOK_FILE" ] || [ -L "$HOOK_FILE" ]; then
  echo "[install-hooks] existing pre-push hook preserved; configure chaining explicitly if needed"
  exit 0
fi

( set -C; cat > "${HOOK_FILE}" <<'HOOK'
#!/usr/bin/env bash
# BODHI pre-push: runs pre-push-checklist before allowing push.
# Mechanically enforces architecture coherence, build health, and risky-
# pattern checks. Agent creation remains outcome-based and is not encoded here.
#
# Bypass: git push --no-verify
set -e
cd "$(git rev-parse --show-toplevel)"
npm run pre-push-checklist
# Advisory desk-check (warn-only — never blocks the push).
npm run desk-check || true
HOOK
)

chmod +x "${HOOK_FILE}"
echo "[install-hooks] installed ${HOOK_FILE#${REPO_ROOT}/}"
