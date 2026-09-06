#!/bin/bash

# Run a repository command under BODHI's required Node 24/npm 11 runtime.
# The caller may be npm itself (npm scripts can invoke this through the shim),
# or may pass node, npm, npx, or a regular executable as the first argument.

set -euo pipefail

BODHI_RUNTIME_WRAPPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
BODHI_DIR="${BODHI_DIR:-$(cd "$(dirname "$BODHI_RUNTIME_WRAPPER")/../.." && pwd)}"
export BODHI_DIR

# shellcheck source=scripts/lib/bodhi-node.sh
. "$BODHI_DIR/scripts/lib/bodhi-node.sh"

NODE_BIN="$(resolve_bodhi_node)"
NPM_CLI="$(resolve_bodhi_npm_cli "$NODE_BIN")"
export BODHI_NPM_CLI="$NPM_CLI"
NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
NPM_VERSION="$("$NODE_BIN" "$NPM_CLI" --version)"

[[ "${NODE_VERSION%%.*}" == "24" ]] || {
  echo "BODHI requires Node 24 (found $NODE_VERSION)." >&2
  exit 1
}
[[ "${NPM_VERSION%%.*}" == "11" ]] || {
  echo "BODHI requires npm 11 (found $NPM_VERSION)." >&2
  exit 1
}

echo "[bodhi-runtime] node=$NODE_BIN version=$NODE_VERSION npm=$NPM_CLI version=$NPM_VERSION" >&2

# npm lifecycle scripts inherit this shim, keeping nested `npm run` calls on
# the same Node 24/npm 11 pair instead of falling back to the shell's npm.
RUNTIME_SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bodhi-runtime.XXXXXX")"
cleanup_runtime_shim() {
  local command_status=$?
  trap - EXIT
  if ! rm -rf -- "$RUNTIME_SHIM_DIR"; then
    [ "$command_status" -ne 0 ] || command_status=1
  fi
  exit "$command_status"
}
trap cleanup_runtime_shim EXIT
ln -s "$BODHI_RUNTIME_WRAPPER" "$RUNTIME_SHIM_DIR/npm"
ln -s "$BODHI_RUNTIME_WRAPPER" "$RUNTIME_SHIM_DIR/npx"
ln -s "$NODE_BIN" "$RUNTIME_SHIM_DIR/node"
export PATH="$RUNTIME_SHIM_DIR:$(dirname "$NODE_BIN"):$BODHI_DIR/node_modules/.bin:$PATH"

invoked_as="$(basename "$0")"
if [ "$invoked_as" = "npm" ]; then
  set -- "$NODE_BIN" "$NPM_CLI" "$@"
elif [ "$invoked_as" = "npx" ]; then
  set -- "$NODE_BIN" "$NPM_CLI" exec "$@"
else
  [ "$#" -gt 0 ] || {
    echo "usage: $0 <node|npm|npx|command> [args...]" >&2
    exit 2
  }
  command_name="$1"
  shift
  case "$command_name" in
    node) set -- "$NODE_BIN" "$@" ;;
    npm) set -- "$NODE_BIN" "$NPM_CLI" "$@" ;;
    npx) set -- "$NODE_BIN" "$NPM_CLI" exec "$@" ;;
    *) set -- "$command_name" "$@" ;;
  esac
fi

# Keep the wrapper alive until the command exits so EXIT can remove the shim.
# Positional arguments also work when empty on macOS Bash 3.2 with nounset.
# Explicit stdin forwarding matters for commands such as `node` without args.
"$@" <&0 &
BODHI_RUNTIME_CHILD_PID=$!
forward_runtime_signal() {
  local signal="$1" exit_status="$2"
  trap - INT TERM
  kill -s "$signal" "$BODHI_RUNTIME_CHILD_PID" 2>/dev/null || true
  wait "$BODHI_RUNTIME_CHILD_PID" 2>/dev/null || true
  exit "$exit_status"
}
trap 'forward_runtime_signal INT 130' INT
trap 'forward_runtime_signal TERM 143' TERM
command_status=0
wait "$BODHI_RUNTIME_CHILD_PID" || command_status=$?
trap - INT TERM
exit "$command_status"
