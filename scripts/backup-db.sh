#!/bin/bash
# Versioned nightly backup producer. --verify checks current archive integrity;
# only the explicit restore-drill command can claim a restored database.
set -euo pipefail
BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"
COMMAND=create
if [[ "${1:-}" == --verify ]]; then COMMAND=verify-latest; shift; fi
exec "$NODE_BIN" "$BODHI_DIR/node_modules/tsx/dist/cli.mjs" "$BODHI_DIR/scripts/backup-db.ts" "$COMMAND" --env-file "$BODHI_DIR/.env" "$@"
