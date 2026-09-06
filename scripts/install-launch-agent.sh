#!/bin/bash
# Install and load the durable per-user BODHI service on macOS.

set -euo pipefail

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTANCE_VALUE="${BODHI_INSTANCE:-}"
if [[ -z "$INSTANCE_VALUE" && -f "$BODHI_DIR/.env" ]]; then
  INSTANCE_VALUE="$(sed -n 's/^BODHI_INSTANCE=//p' "$BODHI_DIR/.env" | tail -1 | sed 's/^"//;s/"$//' || true)"
fi
if [[ -n "$INSTANCE_VALUE" ]] && ! [[ "$INSTANCE_VALUE" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
  echo "BODHI_INSTANCE is invalid." >&2
  exit 1
fi
LABEL="${INSTANCE_VALUE:+com.bodhi.${INSTANCE_VALUE}.server}"
LABEL="${LABEL:-com.bodhi.server}"
DOMAIN="gui/$(id -u)"
SOURCE="$BODHI_DIR/configs/launchd/com.bodhi.server.plist"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
RENDER_ONLY=""

if [[ "${1:-}" == "--render-only" ]]; then
  if [[ -z "${2:-}" || -n "${3:-}" ]]; then
    echo "usage: $0 [--render-only <output.plist>]" >&2
    exit 2
  fi
  RENDER_ONLY="$2"
  TARGET="$RENDER_ONLY"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--render-only <output.plist>]" >&2
  exit 2
fi

plutil -lint "$SOURCE" >/dev/null

mkdir -p "$(dirname "$TARGET")"
RENDERED="$(mktemp "${TMPDIR:-/tmp}/bodhi-launch-agent.XXXXXX.plist")"
trap 'rm -f "$RENDERED"' EXIT
install -m 0600 "$SOURCE" "$RENDERED"

# launchd does not expand HOME or shell variables in these fields. Render the
# canonical root discovered from this checkout instead of shipping one owner's
# username and path to every personal BODHI.
plutil -remove ProgramArguments.1 "$RENDERED"
plutil -replace Label -string "$LABEL" "$RENDERED"
plutil -insert ProgramArguments.1 -string "$BODHI_DIR/scripts/run-server.sh" "$RENDERED"
plutil -replace WorkingDirectory -string "$BODHI_DIR" "$RENDERED"
plutil -replace StandardOutPath -string "$BODHI_DIR/logs/server.log" "$RENDERED"
plutil -replace StandardErrorPath -string "$BODHI_DIR/logs/server.log" "$RENDERED"
plutil -lint "$RENDERED" >/dev/null
if [[ -n "$RENDER_ONLY" ]]; then
  # noclobber uses exclusive creation, including an existing/dangling symlink.
  ( set -C; cat "$RENDERED" > "$TARGET" )
  chmod 0644 "$TARGET"
  echo "BODHI LaunchAgent rendered: $TARGET"
  exit 0
fi

. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"
OWNER_HELPER="$BODHI_DIR/scripts/lib/service-ownership.ts"
"$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL"

PREVIOUS=""
PREVIOUS_MODE=0644
WAS_LOADED=0
REPLACED=0
COMMITTED=0
launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && WAS_LOADED=1
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  "$NODE_BIN" "$OWNER_HELPER" assert-plist "$BODHI_DIR" "$LABEL" "$TARGET"
  PREVIOUS_MODE="$(stat -f %Lp "$TARGET")"
  PREVIOUS="$(mktemp "${TMPDIR:-/tmp}/bodhi-launch-previous.XXXXXX.plist")"
  install -m 0600 "$TARGET" "$PREVIOUS"
fi
cleanup_install() {
  local result=$? restoration_failed=0
  trap - EXIT
  if [ "$COMMITTED" -eq 0 ] && [ "$REPLACED" -eq 1 ]; then
    if "$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    else
      restoration_failed=1
    fi
    if [[ -e "$TARGET" || -L "$TARGET" ]]; then
      "$NODE_BIN" "$OWNER_HELPER" assert-plist "$BODHI_DIR" "$LABEL" "$TARGET" >/dev/null 2>&1 || restoration_failed=1
    fi
    if [ "$restoration_failed" -eq 0 ]; then
      if [[ -n "$PREVIOUS" ]]; then
        install -m "$PREVIOUS_MODE" "$PREVIOUS" "$TARGET" || restoration_failed=1
        if [ "$WAS_LOADED" -eq 1 ] && [ "$restoration_failed" -eq 0 ]; then
          launchctl bootstrap "$DOMAIN" "$TARGET" >/dev/null 2>&1 || launchctl load -w "$TARGET" >/dev/null 2>&1 || restoration_failed=1
          launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || restoration_failed=1
          "$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL" >/dev/null 2>&1 || restoration_failed=1
        fi
      elif [[ -e "$TARGET" ]]; then
        rm -f -- "$TARGET" || restoration_failed=1
      fi
    fi
  fi
  rm -f -- "$RENDERED"
  if [ "$restoration_failed" -ne 0 ]; then
    echo "Prior service could not be restored automatically; preserved plist: $PREVIOUS" >&2
    result=1
  elif [[ -n "$PREVIOUS" ]]; then
    rm -f -- "$PREVIOUS"
  fi
  exit "$result"
}
trap cleanup_install EXIT

PORT_VALUE="${PORT:-}"
if [[ -z "$PORT_VALUE" && -f "$BODHI_DIR/.env" ]]; then
  PORT_VALUE="$(sed -n 's/^PORT=//p' "$BODHI_DIR/.env" | tail -1 | sed 's/^"//;s/"$//' || true)"
fi
PORT_VALUE="${PORT_VALUE:-3000}"
if ! [[ "$PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ ]] || [[ "$PORT_VALUE" -gt 65535 ]]; then
  echo "PORT must be an integer from 1 to 65535." >&2; exit 1
fi
"$NODE_BIN" "$OWNER_HELPER" assert "$BODHI_DIR" "$LABEL" "$PORT_VALUE"
TIMEOUT="${BODHI_START_TIMEOUT_SECONDS:-60}"
if ! [[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || [[ "$TIMEOUT" -gt 300 ]]; then
  echo "BODHI_START_TIMEOUT_SECONDS must be 1..300." >&2; exit 1
fi
REPLACED=1
if [ "$WAS_LOADED" -eq 1 ]; then
  launchctl bootout "$DOMAIN/$LABEL"
fi
install -m 0644 "$RENDERED" "$TARGET"
if ! launchctl bootstrap "$DOMAIN" "$TARGET"; then
  # Some macOS releases need the compatibility loader. Never clear a foreign job.
  "$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL"
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  launchctl load -w "$TARGET"
fi

for _ in $(seq 1 "$TIMEOUT"); do
  if "$NODE_BIN" "$OWNER_HELPER" assert "$BODHI_DIR" "$LABEL" "$PORT_VALUE" >/dev/null 2>&1 \
    && launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 \
    && curl -fsS --max-time 2 "http://localhost:$PORT_VALUE/health" >/dev/null 2>&1; then
    COMMITTED=1
    echo "BODHI LaunchAgent verified: $DOMAIN/$LABEL"
    exit 0
  fi
  sleep 1
done
echo "BODHI LaunchAgent did not become healthy; restoring its prior registration." >&2
exit 1
