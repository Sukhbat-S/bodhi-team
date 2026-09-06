#!/bin/bash
# Foreground BODHI server entrypoint. launchd owns restart/liveness; this script
# owns deterministic runtime selection.

set -euo pipefail

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export BODHI_DIR
mkdir -p "$BODHI_DIR/logs"
cd "$BODHI_DIR"

# shellcheck source=scripts/lib/bodhi-node.sh
. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"

echo "[bodhi-runtime] node=$NODE_BIN version=$($NODE_BIN -v) abi=$($NODE_BIN -p 'process.versions.modules')"
exec "$NODE_BIN" "$BODHI_DIR/node_modules/tsx/dist/cli.mjs" apps/server/src/index.ts
