#!/bin/bash
# Finish a staged personal BODHI installation with an owner-local Voyage key on
# Linux and WSL2. Linux counterpart of activate-personal-voyage-macos.sh; keep
# the two in step. The key is validated, then stored only in this checkout's
# .env (mode 0600); it is never echoed, logged or passed on a command line.

set -euo pipefail

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$BODHI_DIR/.env"
ENV_BACKUP=""
CURL_CONFIG=""
COMPLETE=0

[[ "$(uname -s)" == "Linux" ]] || { echo "personal Linux activation requires Linux (on macOS use activate-personal-voyage-macos.sh)" >&2; exit 1; }
for command in curl; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing prerequisite: $command" >&2; exit 1; }
done
# shellcheck source=scripts/lib/bodhi-node.sh
. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
# shellcheck source=scripts/lib/linux-platform.sh
. "$BODHI_DIR/scripts/lib/linux-platform.sh"
NODE_BIN="$(resolve_bodhi_node)"
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo "staged .env is missing" >&2; exit 1; }
PORT_VALUE="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1 | tr -d '"')"
PORT_VALUE="${PORT_VALUE:-4000}"
[[ "$PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ && "$PORT_VALUE" -le 65535 ]] || { echo "invalid staged port" >&2; exit 1; }
INSTANCE_VALUE="$(sed -n 's/^BODHI_INSTANCE=//p' "$ENV_FILE" | tail -1 | tr -d '"')"
LABEL="${INSTANCE_VALUE:+com.bodhi.${INSTANCE_VALUE}.server}"; LABEL="${LABEL:-com.bodhi.server}"
"$NODE_BIN" "$BODHI_DIR/scripts/lib/service-ownership.ts" assert "$BODHI_DIR" "$LABEL" "$PORT_VALUE"
grep -qx 'BODHI_SETUP_STATE=awaiting-voyage'  "$ENV_FILE" || {
  echo "installation is not awaiting Voyage activation" >&2
  exit 1
}
if grep -q '^VOYAGE_API_KEY=' "$ENV_FILE"; then
  echo "refusing activation: Voyage key is already configured" >&2
  exit 1
fi

if [[ -z "${VOYAGE_API_KEY:-}" && -t 0 ]]; then
  read -r -s -p "Voyage API key (validated, then stored only in local .env): " VOYAGE_API_KEY
  echo
fi
[[ -n "${VOYAGE_API_KEY:-}" ]] || { echo "VOYAGE_API_KEY is required" >&2; exit 1; }
[[ "$VOYAGE_API_KEY" =~ ^[A-Za-z0-9._-]{16,}$ ]] || {
  echo "Voyage API key format is invalid" >&2
  exit 1
}

umask 077
# Remove the key-bearing curl configuration on any exit, including an interrupt during validation.
trap 'if [[ -n "$CURL_CONFIG" ]]; then rm -f -- "$CURL_CONFIG"; fi' EXIT
CURL_CONFIG="$(mktemp "${TMPDIR:-/tmp}/bodhi-voyage-curl.XXXXXX")"
printf 'header = "Authorization: Bearer %s"\n' "$VOYAGE_API_KEY" > "$CURL_CONFIG"
VALIDATION_RESPONSE="$(curl -fsS --max-time 30 --config "$CURL_CONFIG" \
  -H 'Content-Type: application/json' \
  --data '{"input":["BODHI activation check"],"model":"voyage-4-lite","input_type":"document"}' \
  https://api.voyageai.com/v1/embeddings)" || {
    rm -f "$CURL_CONFIG"
    echo "Voyage key validation failed; staged installation was not changed" >&2
    exit 1
  }
rm -f "$CURL_CONFIG"
CURL_CONFIG=""
printf '%s' "$VALIDATION_RESPONSE" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!Array.isArray(j.data)||!Array.isArray(j.data[0]?.embedding)||j.data[0].embedding.length===0)process.exit(1)})' || {
  echo "Voyage validation response did not contain an embedding" >&2
  exit 1
}

ENV_BACKUP="$(mktemp "${TMPDIR:-/tmp}/bodhi-env-backup.XXXXXX")"
install -m 0600 "$ENV_FILE" "$ENV_BACKUP"
rollback_activation() {
  local result=$?
  [[ -n "$CURL_CONFIG" && -f "$CURL_CONFIG" ]] && rm -f "$CURL_CONFIG"
  if [[ "$COMPLETE" -ne 1 && -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    "$NODE_BIN" "$BODHI_DIR/scripts/lib/service-ownership.ts" stop "$BODHI_DIR" "$LABEL" "$PORT_VALUE" >/dev/null 2>&1 || true
    install -m 0600 "$ENV_BACKUP" "$ENV_FILE"
    echo "Voyage activation rolled back; staged configuration was restored" >&2
  fi
  [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]] && rm -f "$ENV_BACKUP"
  exit "$result"
}
trap rollback_activation EXIT

VOYAGE_API_KEY="$VOYAGE_API_KEY" "$NODE_BIN" -e '
  const fs=require("node:fs"); const p=process.argv[1];
  const lines=fs.readFileSync(p,"utf8").split(/\r?\n/).filter(Boolean)
    .filter(line=>line!=="BODHI_SETUP_STATE=awaiting-voyage");
  lines.splice(1,0,`VOYAGE_API_KEY=${process.env.VOYAGE_API_KEY}`);
  fs.writeFileSync(p,`${lines.join("\n")}\n`,{mode:0o600});
' "$ENV_FILE"

bodhi_export_user_runtime_dir
env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} /bin/bash "$BODHI_DIR/scripts/start.sh"
EXPECTED_OWNER="$(sed -n 's/^BODHI_OWNER_NAME="\(.*\)"$/\1/p' "$ENV_FILE")"
STATUS_OWNER="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT_VALUE/api/status" | \
  "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).ownerName||""))')"
[[ -n "$EXPECTED_OWNER" && "$STATUS_OWNER" == "$EXPECTED_OWNER" ]] || {
  echo "health readback owner mismatch" >&2
  exit 1
}

COMPLETE=1
rm -f "$ENV_BACKUP"
ENV_BACKUP=""
trap - EXIT
echo "personal BODHI Voyage activation: PASS"
echo "owner: $STATUS_OWNER"
echo "runtime: healthy on loopback"
