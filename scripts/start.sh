#!/bin/bash
# ============================================================
# BODHI — One-Command Startup (Single Server)
#
# Builds dashboard into static files, then starts ONE server
# that serves both API + Dashboard on the configured PORT.
#
# Usage: ./scripts/start.sh [--dev]
#   --dev  = two-server mode (Vite HMR on :5173 + configured API port)
#   default = production mode (single server on the configured API port)
# ============================================================

set -euo pipefail

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BODHI_DIR/logs"
mkdir -p "$LOG_DIR"

# Match the server's validated PORT contract without sourcing the whole .env
# (which may contain secrets or shell-significant values). An exported PORT
# wins; otherwise read the target's configured value, then use the server
# default. This keeps startup, liveness, and stale-listener cleanup coherent.
BODHI_PORT_VALUE="${PORT:-}"
if [[ -z "$BODHI_PORT_VALUE" && -f "$BODHI_DIR/.env" ]]; then
  BODHI_PORT_VALUE="$(sed -n 's/^PORT=//p' "$BODHI_DIR/.env" | tail -1 | sed 's/^"//;s/"$//' || true)"
fi
BODHI_PORT_VALUE="${BODHI_PORT_VALUE:-3000}"
if ! [[ "$BODHI_PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ ]] || [[ "$BODHI_PORT_VALUE" -gt 65535 ]]; then
  echo "PORT must be an integer from 1 to 65535." >&2
  exit 1
fi
BODHI_INSTANCE_VALUE="${BODHI_INSTANCE:-}"
if [[ -z "$BODHI_INSTANCE_VALUE" && -f "$BODHI_DIR/.env" ]]; then
  BODHI_INSTANCE_VALUE="$(sed -n 's/^BODHI_INSTANCE=//p' "$BODHI_DIR/.env" | tail -1 | sed 's/^"//;s/"$//' || true)"
fi
if [[ -n "$BODHI_INSTANCE_VALUE" ]] && ! [[ "$BODHI_INSTANCE_VALUE" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
  echo "BODHI_INSTANCE is invalid." >&2
  exit 1
fi
SERVICE_LABEL="${BODHI_INSTANCE_VALUE:+com.bodhi.${BODHI_INSTANCE_VALUE}.server}"
SERVICE_LABEL="${SERVICE_LABEL:-com.bodhi.server}"

DEV_MODE=false
if [[ "${1:-}" == "--dev" ]]; then
  DEV_MODE=true
fi

# Use the same validated Node runtime for build/start commands. This avoids a
# native-addon ABI split when Desktop's bundled Node and Homebrew Node differ.
# shellcheck source=scripts/lib/bodhi-node.sh
. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"
export PATH="$(dirname "$NODE_BIN"):$PATH"

echo "=== BODHI Starting ==="

# Refuse a foreign service or listener before stopping anything. The shared
# helper covers loaded jobs, listener identities, parent launchers and old PID
# files without global name sweeps or unowned port kills.
PORTS=("$BODHI_PORT_VALUE")
$DEV_MODE && PORTS+=(5173)
"$NODE_BIN" "$BODHI_DIR/scripts/lib/service-ownership.ts" assert "$BODHI_DIR" "$SERVICE_LABEL" "${PORTS[@]}"
"$NODE_BIN" "$BODHI_DIR/scripts/lib/service-ownership.ts" stop "$BODHI_DIR" "$SERVICE_LABEL" "${PORTS[@]}"
"$NODE_BIN" "$BODHI_DIR/scripts/lib/service-ownership.ts" assert-free "$BODHI_DIR" "$SERVICE_LABEL" "${PORTS[@]}"

cd "$BODHI_DIR"

if $DEV_MODE; then
  # === DEV MODE: Two servers, Vite HMR ===
  echo "Mode: development (two servers)"

  echo "Starting BODHI server on :$BODHI_PORT_VALUE..."
  nohup npm run dev -w @seneca/server > "$LOG_DIR/server.log" 2>&1 &
  echo $! > "$LOG_DIR/server.pid"

  echo "Starting dashboard on :5173..."
  nohup npm run dev -w @seneca/dashboard > "$LOG_DIR/dashboard.log" 2>&1 &
  echo $! > "$LOG_DIR/dashboard.pid"

  # Wait for server
  echo -n "Waiting for server"
  for i in $(seq 1 30); do
    if curl -s "http://localhost:$BODHI_PORT_VALUE/" > /dev/null 2>&1; then
      echo " ready!"
      break
    fi
    echo -n "."
    sleep 1
  done

  echo ""
  echo "=== BODHI Running (dev) ==="
  echo "  API:       http://localhost:$BODHI_PORT_VALUE"
  echo "  Dashboard: http://localhost:5173"
  echo "  Logs:      $LOG_DIR/"

else
  # === PRODUCTION MODE: Single server ===
  echo "Mode: local production (single server)"

  # The optional console is read-only. No bearer is loaded into its build.
  DIST_DIR="$BODHI_DIR/apps/dashboard/dist"
  if [ ! -f "$DIST_DIR/index.html" ]; then
    echo "Building dashboard..."
    npm run build -w @seneca/dashboard
  fi

  # Rebuild if --rebuild flag
  if [[ "${*:-}" == *"--rebuild"* ]]; then
    echo "Rebuilding dashboard..."
    npm run build -w @seneca/dashboard
  fi

  # A user LaunchAgent owns the production process. Unlike a nohup child from a
  # Codex tool shell, launchd survives shell cleanup, restarts crashes, and
  # starts BODHI again after login.
  echo "Starting durable BODHI service on :$BODHI_PORT_VALUE..."
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    bash "$BODHI_DIR/scripts/install-launch-agent.sh"
  else
    nohup bash "$BODHI_DIR/scripts/run-server.sh" > "$LOG_DIR/server.log" 2>&1 &
    echo $! > "$LOG_DIR/server.pid"
  fi

  # Wait for server. A sealed upgrade can briefly need more than 30 seconds on
  # an 8 GB personal Mac after npm install + dashboard rebuild, even when the
  # substrate is healthy. Keep the bound explicit and configurable so the
  # upgrader does not roll back a slow-but-valid first boot.
  START_TIMEOUT_SECONDS="${BODHI_START_TIMEOUT_SECONDS:-60}"
  if ! [[ "$START_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || [ "$START_TIMEOUT_SECONDS" -gt 300 ]; then
    echo "BODHI_START_TIMEOUT_SECONDS must be an integer from 1 to 300." >&2
    exit 1
  fi
  echo -n "Waiting"
  READY=0
  for i in $(seq 1 "$START_TIMEOUT_SECONDS"); do
    if curl -fsS --max-time 2 "http://localhost:$BODHI_PORT_VALUE/api/status" > /dev/null 2>&1; then
      echo " ready!"
      READY=1
      break
    fi
    echo -n "."
    sleep 1
  done

  if [ "$READY" -ne 1 ]; then
    echo " failed!" >&2
    echo "BODHI did not emit a healthy /api/status response within $START_TIMEOUT_SECONDS seconds." >&2
    echo "Inspect: $LOG_DIR/server.log" >&2
    exit 1
  fi

  echo ""
  echo "=== BODHI Running ==="
  echo "  Everything: http://localhost:$BODHI_PORT_VALUE"
  echo "  Logs:       $LOG_DIR/server.log"
fi

echo ""
echo "Stop with: ./scripts/stop.sh"
