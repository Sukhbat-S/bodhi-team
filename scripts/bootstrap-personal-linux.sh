#!/bin/bash
# Prepare a new, local, owner-isolated personal BODHI on Linux: Ubuntu 22.04 or
# 24.04, primarily inside WSL2 on Windows.
#
# Linux counterpart of bootstrap-personal-macos.sh; keep the two in step. It is
# intentionally a fresh-install command with the same contract: dry run by
# default, refusal of an existing .env, owner instructions or database, no
# credentials on the command line, loopback-only service. Updates use the
# separately verified personal-release channel (upgrade-personal-linux.sh).
#
# PostgreSQL differs from Homebrew's local trust: WSL2 forwards loopback ports to
# Windows, so TCP must require a password. Setup commands use the local socket with
# peer authentication; --apply gives the owner's role a generated SCRAM password
# (only its verifier reaches the server) and stores the password only in .env.

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

# shellcheck source=scripts/lib/linux-platform.sh
. "$BODHI_DIR/scripts/lib/linux-platform.sh"

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

[[ "$(uname -s)" == "Linux" ]] || { echo "personal Linux bootstrap requires Linux (on Windows: WSL2 Ubuntu)" >&2; exit 1; }
[[ "$(uname -m)" == "x86_64" || "$(uname -m)" == "aarch64" ]] || {
  echo "unsupported Linux architecture: $(uname -m)" >&2
  exit 1
}

# --- Platform: WSL generation, distribution, systemd, checkout location ---
WSL_KIND="$(bodhi_wsl_kind)"
if [[ "$WSL_KIND" == wsl1 ]]; then
  echo "WSL1 is unsupported: BODHI needs a real Linux kernel. From Windows PowerShell run:" >&2
  echo "  wsl.exe --set-version ${WSL_DISTRO_NAME:-<distribution>} 2" >&2
  exit 1
fi
if [[ "${WSL_DISTRO_NAME:-}" == docker-desktop* ]]; then
  echo "refusing the ${WSL_DISTRO_NAME} distribution: it belongs to Docker Desktop, not BODHI." >&2
  echo "Install and open Ubuntu from Windows PowerShell: wsl.exe --install -d Ubuntu-24.04, then wsl.exe -d Ubuntu-24.04" >&2
  exit 1
fi
read -r OS_ID OS_VERSION OS_CODENAME <<< "$(bodhi_os_release)"
if [[ "${OS_ID:-}" != ubuntu || ( "${OS_VERSION:-}" != 22.04 && "${OS_VERSION:-}" != 24.04 ) ]]; then
  echo "unsupported distribution: ${OS_ID:-unknown} ${OS_VERSION:-unknown} (Ubuntu 22.04 or 24.04 is required)" >&2
  [[ "$WSL_KIND" != wsl2 ]] || echo "From Windows PowerShell: wsl.exe --install -d Ubuntu-24.04" >&2
  exit 1
fi
case "$BODHI_DIR/" in
  /mnt/[a-zA-Z]/*)
    echo "refusing a checkout on the Windows filesystem ($BODHI_DIR)." >&2
    echo "Windows drives under /mnt cannot keep .env private (mode 0600) and are slow for npm and PostgreSQL." >&2
    echo "Extract or clone BODHI inside the Linux filesystem instead, for example: mkdir -p ~/bodhi && cd ~/bodhi" >&2
    exit 1
    ;;
esac
SYSTEMD_STATE="inactive"
if bodhi_systemd_user_available; then
  SYSTEMD_STATE="active"
elif bodhi_pid1_is_systemd; then
  SYSTEMD_STATE="system-only"
fi
WSL_SYSTEMD_CONFIGURED="n/a"
[[ "$WSL_KIND" != wsl2 ]] || WSL_SYSTEMD_CONFIGURED="$(bodhi_wsl_systemd_configured)"

MISSING=()
WINDOWS_BINARIES=()
for command in node npm git psql createdb dropdb pg_dump curl lsof bwrap dpkg-query; do
  if ! RESOLVED="$(command -v "$command" 2>/dev/null)"; then
    MISSING+=("$command")
  elif [[ "$(readlink -f "$RESOLVED" 2>/dev/null || printf '%s' "$RESOLVED")" == /mnt/* ]]; then
    # WSL interop appends the Windows PATH; a Windows node, npm or git must never build or run BODHI.
    WINDOWS_BINARIES+=("$command")
  fi
done
if [[ "${#MISSING[@]}" -gt 0 ]]; then
  echo "missing prerequisite: ${MISSING[*]}" >&2
  bodhi_print_linux_prerequisites >&2
  exit 1
fi
if [[ "${#WINDOWS_BINARIES[@]}" -gt 0 ]]; then
  echo "refusing Windows binaries on the Linux PATH: ${WINDOWS_BINARIES[*]}" >&2
  echo "Install the Linux-native tools (below) and set [interop] appendWindowsPath=false in /etc/wsl.conf." >&2
  bodhi_print_linux_prerequisites >&2
  bodhi_print_wsl_systemd_fix >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NPM_MAJOR="$(npm -v | cut -d. -f1)"
POSTGRES_MAJOR="$(psql --version | awk '{print $3}' | cut -d. -f1)"
[[ "$NODE_MAJOR" == "24" ]] || { echo "Node 24 is required (found $(node -v))" >&2; bodhi_print_linux_prerequisites >&2; exit 1; }
[[ "$NPM_MAJOR" == "11" ]] || { echo "npm 11 is required (found $(npm -v))" >&2; exit 1; }
[[ "$POSTGRES_MAJOR" == "18" ]] || { echo "PostgreSQL 18 client is required (found $(psql --version))" >&2; bodhi_print_linux_prerequisites >&2; exit 1; }
for package in postgresql-18 postgresql-18-pgvector; do
  # shellcheck disable=SC2016 # ${Status} is a dpkg-query field, not a shell expansion
  [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" == "install ok installed" ]] || {
    echo "PGDG package $package is required" >&2
    bodhi_print_linux_prerequisites >&2
    exit 1
  }
done
# Dependency builds run in a bubblewrap sandbox; prove it can create one here.
if ! BWRAP_ERROR="$(bwrap --unshare-all --share-net --die-with-parent --ro-bind / / /bin/true 2>&1)"; then
  echo "bubblewrap cannot create an unprivileged sandbox: ${BWRAP_ERROR:-unknown error}" >&2
  echo "Isolated dependency builds require user namespaces. On WSL2, update WSL from Windows PowerShell (wsl.exe --update)." >&2
  echo "On other Ubuntu hosts, AppArmor's unprivileged user-namespace restriction must allow /usr/bin/bwrap; containers need user namespaces allowed." >&2
  exit 1
fi

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

CURRENT_USER="$(id -un)"
[[ "$CURRENT_USER" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "local username cannot be represented safely in DATABASE_URL" >&2
  exit 1
}
# Setup connections: the local socket with peer authentication, never a stored password.
# PGPASSFILE names a path that cannot exist, so no ~/.pgpass entry can mask a missing password rule.
pg_admin() { env -u PGPASSWORD PGPASSFILE=/nonexistent/bodhi-no-pgpass PGHOST=/var/run/postgresql PGPORT=5432 PGUSER="$CURRENT_USER" "$@"; }
# Succeeds when loopback TCP accepts this role without any password.
tcp_without_password() { env -u PGPASSWORD PGPASSFILE=/nonexistent/bodhi-no-pgpass PGHOST="$1" PGPORT=5432 PGUSER="$CURRENT_USER" PGCONNECT_TIMEOUT=5 psql -X -w postgres -Atqc "SELECT 1" >/dev/null 2>&1; }

if ! pg_admin psql -X postgres -Atqc "SELECT 1" >/dev/null 2>&1; then
  echo "cannot reach local PostgreSQL 18 through its socket as role $CURRENT_USER (peer authentication)" >&2
  bodhi_print_postgres_access_fix >&2
  exit 1
fi
SERVER_MAJOR="$(pg_admin psql -X postgres -Atqc "SELECT current_setting('server_version_num')::int / 10000")"
[[ "$SERVER_MAJOR" == "18" ]] || { echo "PostgreSQL 18 server is required on port 5432 (found major $SERVER_MAJOR)" >&2; exit 1; }
[[ "$(pg_admin psql -X postgres -Atqc "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")" == t ]] || {
  echo "role $CURRENT_USER must be a local superuser, as Homebrew's is on macOS" >&2
  bodhi_print_postgres_access_fix >&2
  exit 1
}
pg_admin psql -X postgres -Atqc "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'" | grep -q '^1$' || {
  echo "the local PostgreSQL 18 server does not offer pgvector (install postgresql-18-pgvector)" >&2
  exit 1
}
# Loopback only, password only: listen_addresses and every host rule that can match this role and database.
LISTEN_ADDRESSES="$(pg_admin psql -X postgres -Atqc "SHOW listen_addresses")"
for address in ${LISTEN_ADDRESSES//,/ }; do
  case "$address" in
    localhost|127.0.0.1|::1) ;;
    *) echo "PostgreSQL listens beyond loopback (listen_addresses = '$LISTEN_ADDRESSES')" >&2; bodhi_print_postgres_hba_fix >&2; exit 1 ;;
  esac
done
UNSAFE_HBA_RULES="$(pg_admin psql -X -At -v db="$DATABASE_NAME" -v role="$CURRENT_USER" postgres <<'SQL'
SELECT count(*) FROM pg_hba_file_rules
WHERE error IS NOT NULL
   OR (type IN ('host', 'hostssl', 'hostnossl', 'hostgssenc', 'hostnogssenc')
       AND database && ARRAY['all', 'sameuser', 'samerole', :'db']::text[]
       AND (user_name && ARRAY['all', :'role']::text[] OR EXISTS (SELECT 1 FROM unnest(user_name) AS name WHERE name LIKE '+%'))
       AND auth_method <> 'reject'
       AND (auth_method <> 'scram-sha-256'
            OR NOT COALESCE(CASE WHEN address ~ '^[0-9A-Fa-f:.]+$' AND netmask ~ '^[0-9A-Fa-f:.]+$' THEN
                 (address::inet = '127.0.0.1'::inet AND netmask::inet = netmask('127.0.0.1/32'::inet))
                 OR (address::inet = '::1'::inet AND netmask::inet = netmask('::1/128'::inet)) END, false)));
SQL
)"
[[ "$UNSAFE_HBA_RULES" == 0 ]] || {
  echo "pg_hba.conf has $UNSAFE_HBA_RULES rule(s) that let role $CURRENT_USER reach database $DATABASE_NAME without scram-sha-256 on loopback (or it has errors)" >&2
  bodhi_print_postgres_hba_fix >&2
  exit 1
}
for host in 127.0.0.1 ::1; do
  if tcp_without_password "$host"; then
    echo "PostgreSQL accepts role $CURRENT_USER over TCP ($host) without a password; WSL2 would expose that to Windows" >&2
    bodhi_print_postgres_hba_fix >&2
    exit 1
  fi
done
[[ "$(pg_admin psql -X postgres -Atqc "SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = current_user")" == t ]] || {
  echo "role $CURRENT_USER already has a password, so another BODHI installation may depend on it; refusing to replace it." >&2
  echo "If no installation uses it: sudo -u postgres psql -c 'ALTER ROLE \"$CURRENT_USER\" PASSWORD NULL'" >&2
  exit 1
}

if pg_admin psql -X postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'" | grep -q '^1$'; then
  echo "refusing fresh install: database '$DATABASE_NAME' already exists" >&2
  exit 1
fi

if [[ "$APPLY" -ne 1 ]]; then
  echo "personal BODHI preflight: PASS"
  echo "owner: $OWNER_NAME"
  echo "assistant: $ASSISTANT_NAME"
  echo "owner aliases: $ALIAS_COUNT"
  echo "database: local PostgreSQL $DATABASE_NAME (new)"
  echo "database access: loopback TCP with a generated scram-sha-256 password, stored only in .env"
  echo "platform: ${OS_ID} ${OS_VERSION} (${OS_CODENAME}) $(uname -m); WSL: ${WSL_KIND}"
  case "$SYSTEMD_STATE" in
    active) echo "service: systemd user unit $LABEL.service (installed by scripts/start.sh)" ;;
    system-only) echo "service: systemd is PID 1 but no user manager answers; scripts/start.sh falls back to a detached process" ;;
    *) echo "service: systemd is not running; scripts/start.sh falls back to a detached process" ;;
  esac
  if [[ "$WSL_KIND" == wsl2 && "$SYSTEMD_STATE" != active ]]; then
    if [[ "$WSL_SYSTEMD_CONFIGURED" == yes ]]; then
      echo "systemd is enabled in /etc/wsl.conf but not running: run 'wsl.exe --shutdown' from Windows PowerShell and reopen the distribution"
    else
      bodhi_print_wsl_systemd_fix
    fi
  fi
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
DB_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
[[ "$DB_PASSWORD" =~ ^[0-9a-f]{64}$ ]] || { echo "could not generate the database password" >&2; exit 1; }
DATABASE_URL="postgresql://${CURRENT_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DATABASE_NAME}"
BODHI_HOME="$STATE_ROOT"
BACKUP_DIR="$BODHI_HOME/backups"
ENV_CREATED=0
OWNER_INSTRUCTIONS_CREATED=0
DATABASE_CREATED=0
PASSWORD_SET=0
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
    # Clear the generated password first: a retained database must not also leave the role
    # password behind, or every re-run would stop at "role already has a password".
    if [[ "$PASSWORD_SET" -eq 1 ]]; then
      pg_admin psql -X -q postgres -c "ALTER ROLE \"$CURRENT_USER\" PASSWORD NULL" >/dev/null 2>&1 || echo "the generated role password could not be removed; clear it: sudo -u postgres psql -c 'ALTER ROLE \"$CURRENT_USER\" PASSWORD NULL'" >&2
    fi
    if [[ "$DATABASE_CREATED" -eq 1 ]]; then
      if ! pg_admin dropdb "$DATABASE_NAME" >/dev/null 2>&1; then echo "fresh-install database could not be removed; retained for explicit recovery" >&2; exit 1; fi
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

pg_admin createdb "$DATABASE_NAME"
DATABASE_CREATED=1
pg_admin psql -X -v ON_ERROR_STOP=1 -d "$DATABASE_NAME" -f "$BASELINE" >/dev/null
# Only a SCRAM-SHA-256 verifier reaches PostgreSQL; the password travels in this process's
# environment to node and into .env, never in arguments, SQL or output.
PASSWORD_SET=1
DB_PASSWORD="$DB_PASSWORD" node -e '
  const { createHash, createHmac, pbkdf2Sync, randomBytes } = require("node:crypto");
  const salt = randomBytes(16), iterations = 4096;
  const salted = pbkdf2Sync(process.env.DB_PASSWORD, salt, iterations, 32, "sha256");
  const storedKey = createHash("sha256").update(createHmac("sha256", salted).update("Client Key").digest()).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
  process.stdout.write(`ALTER ROLE "${process.argv[1]}" PASSWORD \x27${verifier}\x27;\n`);
' "$CURRENT_USER" | pg_admin psql -X -q -v ON_ERROR_STOP=1 postgres >/dev/null
PGPASSWORD="$DB_PASSWORD" PGPASSFILE=/nonexistent/bodhi-no-pgpass PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$CURRENT_USER" psql -X -w -d "$DATABASE_NAME" -Atqc "SELECT 1" >/dev/null 2>&1 || {
  echo "the generated password does not open the database over loopback TCP" >&2
  exit 1
}
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
unset DB_PASSWORD DATABASE_URL
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
  echo "runtime: stopped until scripts/activate-personal-voyage-linux.sh succeeds"
  exit 0
fi

bodhi_export_user_runtime_dir
env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} /bin/bash "$BODHI_DIR/scripts/start.sh"

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
