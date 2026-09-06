#!/bin/bash
# Prepare a new, local, owner-isolated personal BODHI on macOS.
#
# This is intentionally a fresh-install command. It refuses an existing .env or
# database and never accepts credentials as command-line arguments. Updates use
# the separately verified personal-release channel.

set -euo pipefail

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$BODHI_DIR/packages/db/bootstrap/personal-v2.sql"
OWNER_INSTRUCTIONS_TEMPLATE="$BODHI_DIR/templates/personal/AGENTS.md.tpl"
OWNER_NAME=""
ASSISTANT_NAME=""
OWNER_ALIASES_CSV=""
ALIAS_COUNT=0
EXPECTED_MANIFEST_SHA256=""
PORT_VALUE=4000
STATE_ROOT=""
DATABASE_NAME="bodhi"
APPLY=0
DEFER_VOYAGE=0

usage() {
  echo "usage: $0 --owner <display-name> --assistant <display-name> [--owner-alias <name>]... [--database <local-name>] [--port <port>] [--state-root <new-private-directory>] [--expected-manifest-sha256 <sha256>] [--apply [--defer-voyage]]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner)
      [[ -n "${2:-}" ]] || { usage; exit 2; }
      OWNER_NAME="$2"
      shift 2
      ;;
    --assistant)
      [[ -n "${2:-}" ]] || { usage; exit 2; }
      ASSISTANT_NAME="$2"
      shift 2
      ;;
    --owner-alias)
      [[ -n "${2:-}" ]] || { usage; exit 2; }
      [[ "$2" != *$'\n'* && "$2" != *$'\r'* && "$2" != *","* && ${#2} -le 80 ]] || { echo "invalid owner alias" >&2; exit 2; }
      OWNER_ALIASES_CSV="${OWNER_ALIASES_CSV:+$OWNER_ALIASES_CSV,}$2"
      ALIAS_COUNT=$((ALIAS_COUNT + 1))
      shift 2
      ;;
    --database)
      [[ -n "${2:-}" ]] || { usage; exit 2; }
      DATABASE_NAME="$2"
      shift 2
      ;;
    --expected-manifest-sha256) EXPECTED_MANIFEST_SHA256="${2:-}"; shift 2 ;;
    --port) PORT_VALUE="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; shift 2 ;;
    --apply)
      APPLY=1
      shift
      ;;
    --defer-voyage)
      DEFER_VOYAGE=1
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ "$DEFER_VOYAGE" -eq 0 || "$APPLY" -eq 1 ]] || {
  echo "--defer-voyage requires --apply" >&2
  exit 2
}

[[ -n "$OWNER_NAME" ]] || { usage; exit 2; }
[[ -n "$ASSISTANT_NAME" ]] || { usage; exit 2; }
[[ "$OWNER_NAME" != *$'\n'* && "$OWNER_NAME" != *$'\r'* && ${#OWNER_NAME} -le 80 ]] || {
  echo "owner display name must be one line and at most 80 characters" >&2
  exit 2
}
[[ "$ASSISTANT_NAME" != *$'\n'* && "$ASSISTANT_NAME" != *$'\r'* && ${#ASSISTANT_NAME} -le 80 ]] || {
  echo "assistant display name must be one line and at most 80 characters" >&2
  exit 2
}
[[ "$DATABASE_NAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || {
  echo "database name must match ^[a-z][a-z0-9_]{0,62}$" >&2
  exit 2
}

[[ "$(uname -s)" == "Darwin" ]] || { echo "personal macOS bootstrap requires macOS" >&2; exit 1; }
[[ "$(uname -m)" == "arm64" || "$(uname -m)" == "x86_64" ]] || {
  echo "unsupported Mac architecture: $(uname -m)" >&2
  exit 1
}

for command in brew node npm psql createdb dropdb pg_dump plutil launchctl curl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing prerequisite: $command" >&2
    exit 1
  }
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NPM_MAJOR="$(npm -v | cut -d. -f1)"
POSTGRES_MAJOR="$(psql --version | awk '{print $3}' | cut -d. -f1)"
[[ "$NODE_MAJOR" == "24" ]] || { echo "Node 24 is required (found $(node -v))" >&2; exit 1; }
[[ "$NPM_MAJOR" == "11" ]] || { echo "npm 11 is required (found $(npm -v))" >&2; exit 1; }
[[ "$POSTGRES_MAJOR" == "18" ]] || { echo "PostgreSQL 18 client is required (found $(psql --version))" >&2; exit 1; }
brew list --versions postgresql@18 >/dev/null 2>&1 || { echo "Homebrew postgresql@18 is required" >&2; exit 1; }
brew list --versions pgvector >/dev/null 2>&1 || { echo "Homebrew pgvector is required" >&2; exit 1; }

[[ -f "$BASELINE" ]] || { echo "owner-neutral database baseline is missing" >&2; exit 1; }
[[ -f "$OWNER_INSTRUCTIONS_TEMPLATE" ]] || { echo "owner-neutral instruction template is missing" >&2; exit 1; }
if grep -Eiq '[/]Users[/]|OWNER TO|postgres(ql)?://|VOYAGE_API_KEY|BODHI_API_TOKEN|^COPY ' "$BASELINE"; then
  echo "database baseline failed the owner-neutrality guard" >&2
  exit 1
fi
[[ "$(grep -Ec '^INSERT INTO ' "$BASELINE" || true)" -eq 0 ]] || {
  echo "database baseline contains unexpected seed rows" >&2
  exit 1
}

cd "$BODHI_DIR"
[[ ! -e .env ]] || { echo "refusing fresh install: .env already exists" >&2; exit 1; }
[[ ! -e AGENTS.md ]] || { echo "refusing fresh install: AGENTS.md already exists" >&2; exit 1; }
[[ -f "$BODHI_DIR/.release/manifest.json" ]] || { echo "fresh install requires a sealed release" >&2; exit 1; }
if [[ "$APPLY" -eq 1 && -z "$EXPECTED_MANIFEST_SHA256" ]]; then
  echo "--apply requires the independently approved manifest SHA-256" >&2; exit 1
fi
if [[ -n "$EXPECTED_MANIFEST_SHA256" ]]; then
  node "$BODHI_DIR/scripts/verify-personal-release.mjs" --expected-manifest-sha256 "$EXPECTED_MANIFEST_SHA256"
else
  node "$BODHI_DIR/scripts/verify-personal-release.mjs"
fi
if ! [[ "$PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ ]] || [[ "$PORT_VALUE" -gt 65535 ]]; then echo "PORT must be 1..65535" >&2; exit 2; fi
INSTANCE_VALUE="${DATABASE_NAME//_/-}"
LABEL="com.bodhi.$INSTANCE_VALUE.server"
node "$BODHI_DIR/scripts/lib/service-ownership.ts" assert "$BODHI_DIR" "$LABEL" "$PORT_VALUE"
STATE_ROOT="${STATE_ROOT:-$HOME/.bodhi/instances/$DATABASE_NAME}"
STATE_ROOT="$(node -e 'const fs=require("node:fs"),p=require("node:path");function physical(x){return fs.existsSync(x)?fs.realpathSync(x):p.join(physical(p.dirname(x)),p.basename(x))} const root=physical(p.resolve(process.argv[1]));const home=fs.realpathSync(require("node:os").homedir()); if(!root.startsWith(home+p.sep)||fs.existsSync(root)) throw new Error("state root must be a new directory beneath the current user home"); process.stdout.write(root)' "$STATE_ROOT")"

if PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$(id -un)" psql -X postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'" | grep -q '^1$'; then
  echo "refusing fresh install: database '$DATABASE_NAME' already exists" >&2
  exit 1
fi

if [[ "$APPLY" -ne 1 ]]; then
  echo "personal BODHI preflight: PASS"
  echo "owner: $OWNER_NAME"
  echo "assistant: $ASSISTANT_NAME"
  echo "owner aliases: $ALIAS_COUNT"
  echo "database: local PostgreSQL $DATABASE_NAME (new)"
  echo "rerun with --apply after setting VOYAGE_API_KEY in this terminal"
  exit 0
fi

if [[ "$DEFER_VOYAGE" -ne 1 && -z "${VOYAGE_API_KEY:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Voyage API key (stored only in local .env): " VOYAGE_API_KEY
    echo
  fi
fi
[[ "$DEFER_VOYAGE" -eq 1 || -n "${VOYAGE_API_KEY:-}" ]] || {
  echo "VOYAGE_API_KEY is required; export it locally or enter it at the prompt" >&2
  exit 1
}

[[ "${VOYAGE_API_KEY:-}" != *$'\n'* && "${VOYAGE_API_KEY:-}" != *$'\r'* ]] || { echo "credential must be one line" >&2; exit 2; }
CURRENT_USER="$(id -un)"
[[ "$CURRENT_USER" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "local username cannot be represented safely in DATABASE_URL" >&2
  exit 1
}
DATABASE_URL="postgresql://${CURRENT_USER}@127.0.0.1:5432/${DATABASE_NAME}"
BODHI_HOME="$STATE_ROOT"
BACKUP_DIR="$BODHI_HOME/backups"
ENV_CREATED=0
OWNER_INSTRUCTIONS_CREATED=0
DATABASE_CREATED=0
COMPLETE=0
ENV_TMP=""
PRIVATE_BUILD_PROBE=""

rollback_fresh_install() {
  local status=$?
  [[ -z "$PRIVATE_BUILD_PROBE" ]] || rm -f -- "$PRIVATE_BUILD_PROBE"
  if [[ "$COMPLETE" -ne 1 ]]; then
    node "$BODHI_DIR/scripts/lib/service-ownership.ts" stop "$BODHI_DIR" "$LABEL" "$PORT_VALUE" >/dev/null 2>&1 || true
    [[ -n "$ENV_TMP" && -f "$ENV_TMP" ]] && rm -f "$ENV_TMP"
    [[ "$ENV_CREATED" -eq 1 ]] && rm -f "$BODHI_DIR/.env"
    [[ "$OWNER_INSTRUCTIONS_CREATED" -eq 1 ]] && rm -f "$BODHI_DIR/AGENTS.md"
    if [[ "$DATABASE_CREATED" -eq 1 ]]; then
      if ! PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$CURRENT_USER" dropdb "$DATABASE_NAME" >/dev/null 2>&1; then echo "fresh-install database could not be removed; retained for explicit recovery" >&2; exit 1; fi
    fi
    echo "fresh installation rolled back; created database removed" >&2
  fi
  exit "$status"
}
trap rollback_fresh_install EXIT

echo "Installing locked dependencies with Node 24/npm 11..."
PRIVATE_BUILD_PROBE="$(mktemp "${TMPDIR:-/tmp}/bodhi-private-build-probe.XXXXXX")"
printf 'synthetic private build sentinel' > "$PRIVATE_BUILD_PROBE"
node "$BODHI_DIR/scripts/lib/isolated-dependencies.mjs" --root "$BODHI_DIR" --private-probe "$PRIVATE_BUILD_PROBE"
rm -f -- "$PRIVATE_BUILD_PROBE"
PRIVATE_BUILD_PROBE=""

OWNER_NAME="$OWNER_NAME" ASSISTANT_NAME="$ASSISTANT_NAME" \
  node -e 'const fs=require("node:fs"); const p=process.argv[1]; const out=process.argv[2]; let s=fs.readFileSync(p,"utf8"); s=s.replaceAll("{{OWNER_NAME}}",process.env.OWNER_NAME).replaceAll("{{ASSISTANT_NAME}}",process.env.ASSISTANT_NAME); if(s.includes("{{")) throw new Error("unresolved owner-instruction placeholder"); fs.writeFileSync(out,s,{mode:0o600,flag:"wx"});' \
  "$OWNER_INSTRUCTIONS_TEMPLATE" "$BODHI_DIR/AGENTS.md"
OWNER_INSTRUCTIONS_CREATED=1

PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$CURRENT_USER" createdb "$DATABASE_NAME"
DATABASE_CREATED=1
PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$CURRENT_USER" PGDATABASE="$DATABASE_NAME" psql -X -v ON_ERROR_STOP=1 -f "$BASELINE" >/dev/null
mkdir -p "$(dirname "$BODHI_HOME")"
mkdir "$BODHI_HOME"
mkdir "$BACKUP_DIR"
chmod 700 "$BODHI_HOME" "$BACKUP_DIR"

escape_dotenv() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

umask 077
ENV_TMP="$(mktemp "${TMPDIR:-/tmp}/bodhi-env.XXXXXX")"
{
  echo "DATABASE_URL=$DATABASE_URL"
  if [[ "$DEFER_VOYAGE" -eq 1 ]]; then
    echo "BODHI_SETUP_STATE=awaiting-voyage"
  else
    printf 'VOYAGE_API_KEY=%s\n' "$VOYAGE_API_KEY"
  fi
  printf 'BODHI_OWNER_NAME="%s"\n' "$(escape_dotenv "$OWNER_NAME")"
  if [[ "$ALIAS_COUNT" -gt 0 ]]; then
    printf 'BODHI_OWNER_ALIASES="%s"\n' "$(escape_dotenv "$OWNER_ALIASES_CSV")"
  fi
  printf 'BODHI_ASSISTANT_NAME="%s"\n' "$(escape_dotenv "$ASSISTANT_NAME")"
  printf 'BODHI_HOME="%s"\n' "$(escape_dotenv "$BODHI_HOME")"
  printf 'BODHI_PROJECT_DIR="%s"\n' "$(escape_dotenv "$BODHI_DIR")"
  printf 'PORT=%s\n' "$PORT_VALUE"
  printf 'BODHI_PORT=%s\n' "$PORT_VALUE"
  printf 'BODHI_URL=http://localhost:%s\n' "$PORT_VALUE"
  printf 'BODHI_INSTANCE=%s\n' "$INSTANCE_VALUE"
  echo "BODHI_API_AUTH=1"
  printf 'BODHI_API_TOKEN=%s\n' "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  printf 'BODHI_BACKUP_ROOT="%s"\n' "$(escape_dotenv "$BACKUP_DIR")"
  echo "NODE_ENV=production"
  echo "TIMEZONE=Asia/Ulaanbaatar"
} > "$ENV_TMP"
install -m 0600 "$ENV_TMP" "$BODHI_DIR/.env"
rm -f "$ENV_TMP"
ENV_TMP=""
ENV_CREATED=1
node "$BODHI_DIR/node_modules/tsx/dist/cli.mjs" "$BODHI_DIR/scripts/personal-schema.ts" inspect --env-file "$BODHI_DIR/.env" --root "$BODHI_DIR" | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).targetMatch!==true)process.exit(1)})'
node "$BODHI_DIR/node_modules/tsx/dist/cli.mjs" "$BODHI_DIR/scripts/backup-db.ts" create --env-file "$BODHI_DIR/.env" --local-root "$BACKUP_DIR" >/dev/null

if [[ "$DEFER_VOYAGE" -eq 1 ]]; then
  COMPLETE=1
  trap - EXIT
  echo "personal BODHI staged install: PASS"
  echo "owner: $OWNER_NAME"
  echo "assistant: $ASSISTANT_NAME"
  echo "database: local and owner-isolated"
  echo "backup: checksummed private rollback point created"
  echo "runtime: stopped until scripts/activate-personal-voyage-macos.sh succeeds"
  exit 0
fi

env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" /bin/bash "$BODHI_DIR/scripts/start.sh"

STATUS_OWNER="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT_VALUE/api/status" | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).ownerName||""))')"
[[ "$STATUS_OWNER" == "$OWNER_NAME" ]] || {
  echo "health readback owner mismatch" >&2
  exit 1
}

COMPLETE=1
trap - EXIT
echo "personal BODHI install: PASS"
echo "owner: $OWNER_NAME"
echo "assistant: $ASSISTANT_NAME"
echo "database: local and owner-isolated"
echo "backup: checksummed private rollback point created"
