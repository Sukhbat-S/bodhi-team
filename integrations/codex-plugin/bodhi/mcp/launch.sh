#!/bin/bash
set -euo pipefail
MCP_DIR="$(cd "$(dirname "$0")" && pwd -P)"
BODHI_DIR="$(cd "$MCP_DIR/.." && pwd -P)"
. "$MCP_DIR/runtime.sh"
NODE_BIN="$(resolve_bodhi_node --no-native-modules)"
exec "$NODE_BIN" "$MCP_DIR/launch.cjs"
