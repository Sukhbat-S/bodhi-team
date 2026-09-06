#!/bin/bash
# Pinned, staged local personal release replacement. Default is read-only preflight.
set -euo pipefail
TRUSTED_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$TRUSTED_ROOT/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"
ORIGINAL_ARGS=("$@")
RELEASE_ROOT="" TARGET_ROOT="" EXPECTED_MANIFEST_SHA256="" APPROVED_SCHEMA_SHA256="" PRESERVE_TEXT=""
APPLY=0 DEFER_START=0
usage() { echo "usage: $0 --release <sealed-directory> --target <installed-directory> [--expected-manifest-sha256 <sha256>] [--approved-schema-plan-sha256 <sha256>] [--preserve <relative-private-path>]... [--apply] [--defer-start]" >&2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) RELEASE_ROOT="${2:-}"; shift 2 ;;
    --target) TARGET_ROOT="${2:-}"; shift 2 ;;
    --expected-manifest-sha256) EXPECTED_MANIFEST_SHA256="${2:-}"; shift 2 ;;
    --approved-schema-plan-sha256) APPROVED_SCHEMA_SHA256="${2:-}"; shift 2 ;;
    --preserve) PRESERVE_TEXT="${PRESERVE_TEXT}${2:-}"$'\n'; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --defer-start) DEFER_START=1; shift ;;
    *) usage; exit 2 ;;
  esac
done
[[ -n "$RELEASE_ROOT" && -n "$TARGET_ROOT" ]] || { usage; exit 2; }
[[ "$(uname -s)" == Darwin ]] || { echo "personal upgrade requires macOS" >&2; exit 1; }
[[ -d "$TARGET_ROOT" && ! -L "$TARGET_ROOT" ]] || { echo "target must be an existing real directory" >&2; exit 1; }
TARGET_ROOT="$(cd "$TARGET_ROOT" && pwd -P)"
RELEASE_ROOT="$(cd "$RELEASE_ROOT" && pwd -P)"
case "$RELEASE_ROOT/" in "$TARGET_ROOT/"*) echo "release overlaps target" >&2; exit 1;; esac
case "$TARGET_ROOT/" in "$RELEASE_ROOT/"*) echo "target overlaps release" >&2; exit 1;; esac
[[ -f "$TARGET_ROOT/.env" && ! -L "$TARGET_ROOT/.env" ]] || { echo "target environment is missing or unsafe" >&2; exit 1; }
[[ "$APPLY" -eq 0 || -n "$EXPECTED_MANIFEST_SHA256" ]] || { echo "--apply requires the independently approved manifest SHA-256" >&2; exit 1; }
if [[ "$APPLY" -eq 1 && "${BODHI_INSTALL_LOCK_HELD:-}" != 1 ]]; then
  exec "$NODE_BIN" "$TRUSTED_ROOT/scripts/lib/with-install-lock.mjs" "$TARGET_ROOT" /bin/bash "$TRUSTED_ROOT/scripts/upgrade-personal-macos.sh" "${ORIGINAL_ARGS[@]}"
fi
VERIFIER="$TRUSTED_ROOT/scripts/verify-personal-release.mjs"
if [[ -n "$EXPECTED_MANIFEST_SHA256" ]]; then
  "$NODE_BIN" "$VERIFIER" --root "$RELEASE_ROOT" --expected-manifest-sha256 "$EXPECTED_MANIFEST_SHA256"
else
  "$NODE_BIN" "$VERIFIER" --root "$RELEASE_ROOT"
fi
STATE_HELPER="$TRUSTED_ROOT/scripts/lib/release-install-state.mjs"
OWNER_HELPER="$TRUSTED_ROOT/scripts/lib/service-ownership.ts"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bodhi-upgrade-review.XXXXXX")"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
inventory() {
  local output="$1"
  set -- "$NODE_BIN" "$STATE_HELPER" inventory --root "$TARGET_ROOT" --output "$output"
  while IFS= read -r preserve; do [[ -z "$preserve" ]] || set -- "$@" --preserve "$preserve"; done <<< "$PRESERVE_TEXT"
  "$@"
}
inventory "$TEMP_ROOT/preflight.json"
read_manifest() { "$NODE_BIN" -e 'let v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); for(const k of process.argv[2].split("."))v=v?.[k]; if(v===undefined)process.exit(1);process.stdout.write(String(v))' "$1" "$2"; }
CURRENT_VERSION="$(read_manifest "$TARGET_ROOT/.release/manifest.json" releaseVersion)"
NEXT_VERSION="$(read_manifest "$RELEASE_ROOT/.release/manifest.json" releaseVersion)"
[[ "$(read_manifest "$RELEASE_ROOT/.release/manifest.json" contractVersion)" == 2 ]] || { echo "incoming release needs the explicit schema-baseline contract" >&2; exit 1; }
VERSION_ORDER="$("$NODE_BIN" "$STATE_HELPER" compare-version "$NEXT_VERSION" "$CURRENT_VERSION")"
[[ "$VERSION_ORDER" -ge 0 ]] || { echo "release downgrade is unsupported" >&2; exit 1; }
CURRENT_MANIFEST_SHA="$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "$TARGET_ROOT/.release/manifest.json")"
NEXT_MANIFEST_SHA="$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "$RELEASE_ROOT/.release/manifest.json")"
if [[ "$VERSION_ORDER" -eq 0 ]]; then
  [[ "$CURRENT_MANIFEST_SHA" == "$NEXT_MANIFEST_SHA" ]] || { echo "the same release version has different immutable bytes" >&2; exit 1; }
  echo "personal BODHI already has this exact release installed"; exit 0
fi
operator_setting() {
  "$NODE_BIN" -e 'const fs=require("node:fs");const key=process.argv[2];if(!["PORT","BODHI_HOME","BODHI_INSTANCE","BODHI_OWNER_NAME"].includes(key))process.exit(2);const text=fs.readFileSync(process.argv[1],"utf8");let raw=text.split(/\r?\n/).find(x=>x.startsWith(key+"="))?.slice(key.length+1).trim()??"";if(raw.startsWith("\"")){raw=JSON.parse(raw)}else if(raw.startsWith("\x27")){raw=raw.slice(1,-1)}process.stdout.write(raw)' "$TARGET_ROOT/.env" "$1"
}
PORT_VALUE="$(operator_setting PORT)"; PORT_VALUE="${PORT_VALUE:-3000}"
INSTANCE_VALUE="$(operator_setting BODHI_INSTANCE)"
LABEL="${INSTANCE_VALUE:+com.bodhi.${INSTANCE_VALUE}.server}"; LABEL="${LABEL:-com.bodhi.server}"
[[ "$PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ && "$PORT_VALUE" -le 65535 ]] || { echo "invalid target port" >&2; exit 1; }
"$NODE_BIN" "$OWNER_HELPER" assert "$TARGET_ROOT" "$LABEL" "$PORT_VALUE"
if [[ "$APPLY" -eq 0 ]]; then
  echo "personal BODHI upgrade preflight: PASS ($CURRENT_VERSION -> $NEXT_VERSION; source/private inventory checked)"
  echo "Apply requires pinned release identity; schema changes also require their exact approved plan hash."
  exit 0
fi
umask 077
BODHI_STATE_ROOT="$(operator_setting BODHI_HOME)"; BODHI_STATE_ROOT="${BODHI_STATE_ROOT:-$HOME/.bodhi}"
BODHI_STATE_ROOT="$("$NODE_BIN" -e 'const fs=require("node:fs"),p=require("node:path");function physical(x){return fs.existsSync(x)?fs.realpathSync(x):p.join(physical(p.dirname(x)),p.basename(x))}const x=process.argv[1];if(!p.isAbsolute(x))throw new Error("state root must be absolute");const root=physical(x),home=fs.realpathSync(require("node:os").homedir());if(!root.startsWith(home+p.sep))throw new Error("state root must stay beneath the owner home");process.stdout.write(root)' "$BODHI_STATE_ROOT")"
BACKUP_ROOT="$BODHI_STATE_ROOT/backups/releases"
case "$BACKUP_ROOT/" in "$TARGET_ROOT/"*|"$RELEASE_ROOT/"*) echo "recovery root must be outside both install trees" >&2; exit 1;; esac
mkdir -p "$BACKUP_ROOT"
ROLLBACK_ROOT="$(mktemp -d "$BACKUP_ROOT/upgrade.XXXXXX")"
chmod 700 "$ROLLBACK_ROOT"
STAGE_ROOT="$(mktemp -d "$(dirname "$TARGET_ROOT")/.bodhi-upgrade.XXXXXX")"
OLD_TREE="$ROLLBACK_ROOT/installed-tree" FAILED_TREE="$ROLLBACK_ROOT/failed-tree"
OLD_MOVED=0 OLD_STOPPED=0 DATABASE_CHANGED=0 COMPLETE=0 DB_BACKUP=""
WAS_LOADED=0
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && WAS_LOADED=1
if [[ "$WAS_LOADED" -eq 0 ]] && lsof -tiTCP:"$PORT_VALUE" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "running unmanaged service is unsupported; install its owned LaunchAgent or stop it before upgrading" >&2
  exit 1
fi
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [[ "$WAS_LOADED" -eq 1 ]]; then
  "$NODE_BIN" "$OWNER_HELPER" assert-plist "$TARGET_ROOT" "$LABEL" "$PLIST"
  cp -p "$PLIST" "$ROLLBACK_ROOT/previous-service.plist"
fi
rollback_upgrade() {
  local result=$? restored=1
  trap - EXIT
  if [[ "$COMPLETE" -ne 1 ]]; then
    if [[ "$OLD_MOVED" -eq 1 ]]; then "$NODE_BIN" "$OWNER_HELPER" stop "$TARGET_ROOT" "$LABEL" "$PORT_VALUE" >/dev/null 2>&1 || restored=0; fi
    if [[ "$DATABASE_CHANGED" -eq 1 && -n "$DB_BACKUP" ]]; then
      local runtime_root="$STAGE_ROOT"
      if [[ "$OLD_MOVED" -eq 1 && -d "$TARGET_ROOT/node_modules" ]]; then runtime_root="$TARGET_ROOT"; fi
      "$NODE_BIN" "$runtime_root/node_modules/tsx/dist/cli.mjs" "$runtime_root/scripts/personal-schema.ts" restore --root "$runtime_root" --env-file "$runtime_root/.env" --file "$DB_BACKUP" --approved-plan-sha256 "$PLAN_SHA" || restored=0
    fi
    if [[ "$OLD_MOVED" -eq 1 && -d "$OLD_TREE" ]]; then
      [[ ! -d "$TARGET_ROOT" ]] || mv "$TARGET_ROOT" "$FAILED_TREE" || restored=0
      [[ ! -d "$OLD_TREE" ]] || mv "$OLD_TREE" "$TARGET_ROOT" || restored=0
      "$NODE_BIN" "$STATE_HELPER" verify-copy --root "$TARGET_ROOT" --evidence "$ROLLBACK_ROOT/private-state.json" || restored=0
    fi
    if [[ "$OLD_STOPPED" -eq 1 && "$restored" -eq 1 && "$WAS_LOADED" -eq 1 ]]; then
      cp -p "$ROLLBACK_ROOT/previous-service.plist" "$PLIST"
      launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || restored=0
      "$NODE_BIN" "$OWNER_HELPER" assert-agent "$TARGET_ROOT" "$LABEL" >/dev/null 2>&1 || restored=0
      launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || restored=0
      local recovered_health=0
      for _ in $(seq 1 60); do
        if "$NODE_BIN" "$OWNER_HELPER" assert "$TARGET_ROOT" "$LABEL" "$PORT_VALUE" >/dev/null 2>&1 && curl -fsS --max-time 2 "http://localhost:$PORT_VALUE/health" >/dev/null 2>&1; then recovered_health=1; break; fi
        sleep 1
      done
      [[ "$recovered_health" -eq 1 ]] || restored=0
    fi
    if [[ "$restored" -eq 1 ]]; then echo "prior application/private state restored; recovery artifacts retained: $ROLLBACK_ROOT" >&2
    else echo "automatic recovery incomplete; service must stay stopped. Evidence retained: $ROLLBACK_ROOT" >&2; result=1; fi
  fi
  rm -rf -- "$TEMP_ROOT"
  exit "$result"
}
trap rollback_upgrade EXIT
cp -pR "$RELEASE_ROOT/." "$STAGE_ROOT/"
printf 'synthetic private isolation sentinel' > "$TEMP_ROOT/private-probe"
"$NODE_BIN" "$TRUSTED_ROOT/scripts/lib/isolated-dependencies.mjs" --root "$STAGE_ROOT" --private-probe "$TEMP_ROOT/private-probe"
"$NODE_BIN" "$VERIFIER" --root "$STAGE_ROOT" --expected-manifest-sha256 "$NEXT_MANIFEST_SHA" --prepared
# Refuse a proven credential cutover until it has its separately approved revocation/client-rebinding plan.
"$NODE_BIN" -e 'const fs=require("node:fs"),p=require("node:path");const root=process.argv[1];const env=fs.readFileSync(p.join(root,".env"),"utf8");const token=env.split(/\r?\n/).find(x=>x.startsWith("BODHI_API_TOKEN="))?.slice(16).replace(/^"|"$/g,"");function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const x=p.join(dir,e.name);if(e.isDirectory())walk(x);else if(e.isFile()&&token&&token.length>=16&&fs.readFileSync(x).includes(Buffer.from(token)))throw new Error("installed assets contain the current bearer; complete the explicit authentication cutover before automatic upgrade")}}walk(p.join(root,"apps/dashboard/dist"));' "$TARGET_ROOT"
[[ "$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "$TARGET_ROOT/.release/manifest.json")" == "$CURRENT_MANIFEST_SHA" ]] || { echo "installation changed during staging" >&2; exit 1; }
"$NODE_BIN" "$OWNER_HELPER" stop "$TARGET_ROOT" "$LABEL" "$PORT_VALUE"
OLD_STOPPED=1
"$NODE_BIN" "$OWNER_HELPER" assert-free "$TARGET_ROOT" "$LABEL" "$PORT_VALUE"
inventory "$ROLLBACK_ROOT/private-state.json"
while IFS= read -r private_path; do
  [[ -n "$private_path" ]] || continue
  mkdir -p "$(dirname "$STAGE_ROOT/$private_path")"
  cp -pR "$TARGET_ROOT/$private_path" "$STAGE_ROOT/$private_path"
done < <("$NODE_BIN" -e 'for(const p of JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).privatePaths)console.log(p)' "$ROLLBACK_ROOT/private-state.json")
"$NODE_BIN" "$STATE_HELPER" verify-copy --root "$STAGE_ROOT" --evidence "$ROLLBACK_ROOT/private-state.json"
SCHEMA_STATE="$("$NODE_BIN" "$STAGE_ROOT/node_modules/tsx/dist/cli.mjs" "$STAGE_ROOT/scripts/personal-schema.ts" inspect --root "$STAGE_ROOT" --env-file "$STAGE_ROOT/.env")"
PLAN_SHA="$(printf '%s' "$SCHEMA_STATE" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).approvedPlanSha256))')"
TARGET_MATCH="$(printf '%s' "$SCHEMA_STATE" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).targetMatch)))')"
if [[ "$TARGET_MATCH" != true ]]; then
  [[ "$APPROVED_SCHEMA_SHA256" == "$PLAN_SHA" ]] || { echo "schema change requires its exact approved plan SHA-256" >&2; exit 1; }
  printf '%s' "$SCHEMA_STATE" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!JSON.parse(s).sourceMatch)process.exit(1)})' || { echo "live schema is outside the supported baseline" >&2; exit 1; }
fi
BACKUP_RESULT="$("$NODE_BIN" "$STAGE_ROOT/node_modules/tsx/dist/cli.mjs" "$STAGE_ROOT/scripts/personal-schema.ts" backup --root "$STAGE_ROOT" --env-file "$STAGE_ROOT/.env" --backup-root "$ROLLBACK_ROOT")"
DB_BACKUP="$(printf '%s' "$BACKUP_RESULT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).file))')"
# Keep this flag before applying so a post-commit evidence failure also restores.
if [[ "$TARGET_MATCH" != true ]]; then
  DATABASE_CHANGED=1
  "$NODE_BIN" "$STAGE_ROOT/node_modules/tsx/dist/cli.mjs" "$STAGE_ROOT/scripts/personal-schema.ts" apply --root "$STAGE_ROOT" --env-file "$STAGE_ROOT/.env" --file "$DB_BACKUP" --approved-plan-sha256 "$PLAN_SHA"
fi
"$NODE_BIN" "$STATE_HELPER" verify-copy --root "$TARGET_ROOT" --evidence "$ROLLBACK_ROOT/private-state.json"
OLD_MOVED=1
mv "$TARGET_ROOT" "$OLD_TREE"
mv "$STAGE_ROOT" "$TARGET_ROOT"
"$NODE_BIN" "$STATE_HELPER" verify-copy --root "$TARGET_ROOT" --evidence "$ROLLBACK_ROOT/private-state.json"
if [[ "$DEFER_START" -ne 1 ]]; then
  DATABASE_CHANGED=1
  env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" /bin/bash "$TARGET_ROOT/scripts/start.sh"
  EXPECTED_OWNER="$(operator_setting BODHI_OWNER_NAME)"
  curl -fsS --max-time 5 "http://localhost:$PORT_VALUE/api/status" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);if(v.substrate!=="online"||v.memory!=="active"||v.ownerName!==process.argv[1])process.exit(1)})' "$EXPECTED_OWNER"
fi
"$NODE_BIN" "$TARGET_ROOT/scripts/check-personal-coherence.mjs" --root "$TARGET_ROOT" --json >/dev/null
"$NODE_BIN" -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({contractVersion:2,installedAt:new Date().toISOString(),manifestSha256:process.argv[2],databaseBackup:process.argv[3],rollbackTree:process.argv[4],runtime:process.argv[5]},null,2)+"\n",{mode:0o600,flag:"wx"})' "$TARGET_ROOT/.release/installation.json" "$NEXT_MANIFEST_SHA" "$DB_BACKUP" "$OLD_TREE" "$([[ "$DEFER_START" -eq 1 ]] && echo stopped || echo verified)"
COMPLETE=1
echo "personal BODHI upgrade: PASS ($CURRENT_VERSION -> $NEXT_VERSION)"
echo "verification receipt: $TARGET_ROOT/.release/installation.json"
