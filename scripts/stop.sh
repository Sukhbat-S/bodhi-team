#!/bin/bash
set -euo pipefail

# ============================================================
# BODHI — Clean Shutdown
# Usage: ./scripts/stop.sh
# ============================================================

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BODHI_DIR/logs"
ENV_FILE="${BODHI_ENV_FILE:-$BODHI_DIR/.env}"
PORT_VALUE="${PORT:-}"
if [[ -z "$PORT_VALUE" && -f "$ENV_FILE" ]]; then
  PORT_VALUE="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1 | sed 's/^"//;s/"$//' || true)"
fi
PORT_VALUE="${PORT_VALUE:-3000}"
if ! [[ "$PORT_VALUE" =~ ^[1-9][0-9]{0,4}$ ]] || [[ "$PORT_VALUE" -gt 65535 ]]; then
  echo "PORT must be an integer from 1 to 65535." >&2
  exit 1
fi
INSTANCE_VALUE="${BODHI_INSTANCE:-}"
if [[ -z "$INSTANCE_VALUE" && -f "$ENV_FILE" ]]; then
  INSTANCE_VALUE="$(sed -n 's/^BODHI_INSTANCE=//p' "$ENV_FILE" | tail -1 | sed 's/^"//;s/"$//' || true)"
fi
if [[ -n "$INSTANCE_VALUE" ]] && ! [[ "$INSTANCE_VALUE" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
  echo "BODHI_INSTANCE is invalid." >&2
  exit 1
fi
SERVICE_LABEL="${INSTANCE_VALUE:+com.bodhi.${INSTANCE_VALUE}.server}"
SERVICE_LABEL="${SERVICE_LABEL:-com.bodhi.server}"

echo "=== BODHI Stopping ==="

. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"
"$NODE_BIN" "$BODHI_DIR/scripts/lib/service-ownership.ts" stop "$BODHI_DIR" "$SERVICE_LABEL" "$PORT_VALUE" 5173

echo "=== BODHI Stopped ==="
