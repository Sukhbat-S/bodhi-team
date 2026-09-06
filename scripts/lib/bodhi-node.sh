#!/bin/bash

# Resolve a Node runtime that can actually load BODHI's installed native
# modules. The interactive shell is not authoritative: Codex Desktop and
# Homebrew can expose different Node majors, while better-sqlite3 is ABI-bound.
resolve_bodhi_node() {
  local check_native=1
  case "${1:-}" in
    "") ;;
    --no-native-modules) check_native=0 ;;
    *) echo "unknown Node runtime verification mode" >&2; return 2 ;;
  esac
  local bodhi_dir="${BODHI_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  local candidate
  local node_version
  local candidates=()

  [ -n "${BODHI_NODE:-}" ] && candidates+=("$BODHI_NODE")
  if [ -z "${BODHI_NODE:-}" ]; then
    candidates+=(
      "$bodhi_dir/.runtime/node/bin/node"
      "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
      "/opt/homebrew/opt/node@24/bin/node"
      "/usr/local/opt/node@24/bin/node"
    )

    candidate="$(command -v node 2>/dev/null || true)"
    [ -n "$candidate" ] && candidates+=("$candidate")
  fi

  for candidate in "${candidates[@]}"; do
    [ -x "$candidate" ] || continue
    node_version="$("$candidate" -p 'process.versions.node' 2>/dev/null || true)"
    [[ "${node_version%%.*}" == "24" ]] || continue
    if [[ "$check_native" -eq 0 ]] || (
      cd "$bodhi_dir"
      "$candidate" -e \
        "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close()" \
        >/dev/null 2>&1
    ); then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [[ "$check_native" -eq 0 ]]; then
    echo "BODHI MCP cannot find a Node 24 runtime; set BODHI_NODE to a Node 24 binary." >&2
    return 1
  fi
  printf '%s\n' \
    "BODHI cannot find a Node 24 runtime compatible with the installed better-sqlite3 binary." \
    "Set BODHI_NODE to a Node 24 binary, or reinstall dependencies with the intended runtime." >&2
  return 1
}

# Resolve npm's CLI JavaScript entry point separately from the npm launcher.
# Homebrew's npm launcher has a /usr/bin/env node shebang, so putting Node 24
# first on PATH is not sufficient: execute the CLI through the selected node.
resolve_bodhi_npm_cli() {
  local node_bin="${1:?resolve_bodhi_npm_cli requires a Node binary}"
  local candidate
  local npm_launcher
  local launcher_real
  local node_prefix
  local npm_version
  local candidates=()

  [ -n "${BODHI_NPM_CLI:-}" ] && candidates+=("$BODHI_NPM_CLI")
  node_prefix="$(cd "$(dirname "$node_bin")/.." 2>/dev/null && pwd || true)"
  [ -n "$node_prefix" ] && candidates+=("$node_prefix/lib/node_modules/npm/bin/npm-cli.js")
  candidates+=(
    "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js"
    "/usr/local/lib/node_modules/npm/bin/npm-cli.js"
  )

  npm_launcher="$(command -v npm 2>/dev/null || true)"
  if [ -n "$npm_launcher" ] && [ -f "$npm_launcher" ]; then
    candidates+=(
      "$(dirname "$npm_launcher")/../lib/node_modules/npm/bin/npm-cli.js"
      "$(dirname "$npm_launcher")/../../lib/node_modules/npm/bin/npm-cli.js"
    )
    launcher_real="$(realpath "$npm_launcher" 2>/dev/null || true)"
    if [ -n "$launcher_real" ]; then
      candidates+=("$(dirname "$launcher_real")/../lib/node_modules/npm/bin/npm-cli.js")
    fi
  fi

  for candidate in "${candidates[@]}"; do
    [ -f "$candidate" ] || continue
    npm_version="$("$node_bin" "$candidate" --version 2>/dev/null || true)"
    [[ "${npm_version%%.*}" == "11" ]] || continue
    printf '%s\n' "$candidate"
    return 0
  done

  printf '%s\n' \
    "BODHI cannot find an npm 11 CLI that can run under the selected Node 24 runtime." \
    "Set BODHI_NPM_CLI to npm-cli.js from npm 11, or install npm 11 for the intended runtime." >&2
  return 1
}
