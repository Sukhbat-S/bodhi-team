#!/bin/bash
# Install and start the durable per-user BODHI service on Linux and WSL2 with
# systemd: a systemd user unit that restarts on failure and logs to journald.
# Linux counterpart of install-launch-agent.sh; keep the two in step.
#
# Logs:    journalctl --user -u <label>.service -f
# Status:  systemctl --user status <label>.service
# Without systemd, scripts/start.sh runs BODHI as a detached process instead;
# see docs/windows-wsl2.md ("Running without systemd").

set -euo pipefail

BODHI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/linux-platform.sh
. "$BODHI_DIR/scripts/lib/linux-platform.sh"
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
UNIT="$LABEL.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
TARGET="$UNIT_DIR/$UNIT"
RENDER_ONLY=""

if [[ "${1:-}" == "--render-only" ]]; then
  if [[ -z "${2:-}" || -n "${3:-}" ]]; then
    echo "usage: $0 [--render-only <output.service>]" >&2
    exit 2
  fi
  RENDER_ONLY="$2"
  TARGET="$RENDER_ONLY"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--render-only <output.service>]" >&2
  exit 2
fi

# systemd expands % specifiers and $ variables and splits on quotes; refuse
# checkout paths that cannot be rendered literally instead of escaping them.
if [[ "$BODHI_DIR" == *[%\$\"\\]* || "$BODHI_DIR" == *$'\n'* ]]; then
  echo "the checkout path contains %, \$, a quote, a backslash or a newline; move BODHI to a plain path" >&2
  exit 1
fi

RENDERED="$(mktemp "${TMPDIR:-/tmp}/bodhi-systemd-unit.XXXXXX")"
trap 'rm -f "$RENDERED"' EXIT
# Rendered from this checkout's canonical root, as the LaunchAgent plist is,
# so no owner's username or path ships in the release.
cat > "$RENDERED" <<EOF
[Unit]
Description=BODHI personal substrate ($LABEL)
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=$BODHI_DIR
ExecStart=/bin/bash "$BODHI_DIR/scripts/run-server.sh"
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$LABEL

[Install]
WantedBy=default.target
EOF
chmod 0644 "$RENDERED"
if [[ -n "$RENDER_ONLY" ]]; then
  mkdir -p "$(dirname "$TARGET")"
  # noclobber uses exclusive creation, including an existing/dangling symlink.
  ( set -C; cat "$RENDERED" > "$TARGET" )
  chmod 0644 "$TARGET"
  echo "BODHI systemd user unit rendered: $TARGET"
  exit 0
fi

[[ "$(uname -s)" == "Linux" ]] || { echo "systemd user services require Linux; on macOS use scripts/install-launch-agent.sh" >&2; exit 1; }
if ! bodhi_systemd_user_available; then
  echo "No systemd user manager answers for $(id -un); the BODHI unit cannot be installed." >&2
  if [[ "$(bodhi_wsl_kind)" == wsl2 ]]; then bodhi_print_wsl_systemd_fix >&2; fi
  echo "Fallback: run scripts/start.sh, which starts BODHI as a detached process." >&2
  exit 1
fi

. "$BODHI_DIR/scripts/lib/bodhi-node.sh"
NODE_BIN="$(resolve_bodhi_node)"
OWNER_HELPER="$BODHI_DIR/scripts/lib/service-ownership.ts"
"$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL"

PREVIOUS=""
PREVIOUS_MODE=0644
WAS_ACTIVE=0
WAS_ENABLED=0
REPLACED=0
COMMITTED=0
systemctl --user is-active --quiet "$UNIT" && WAS_ACTIVE=1
systemctl --user is-enabled --quiet "$UNIT" 2>/dev/null && WAS_ENABLED=1
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  "$NODE_BIN" "$OWNER_HELPER" assert-unit-file "$BODHI_DIR" "$LABEL" "$TARGET"
  PREVIOUS_MODE="$(stat -c %a "$TARGET")"
  PREVIOUS="$(mktemp "${TMPDIR:-/tmp}/bodhi-systemd-previous.XXXXXX")"
  install -m 0600 "$TARGET" "$PREVIOUS"
fi
cleanup_install() {
  local result=$? restoration_failed=0
  trap - EXIT
  if [ "$COMMITTED" -eq 0 ] && [ "$REPLACED" -eq 1 ]; then
    if "$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL" >/dev/null 2>&1; then
      systemctl --user stop "$UNIT" >/dev/null 2>&1 || true
    else
      restoration_failed=1
    fi
    if [[ -e "$TARGET" || -L "$TARGET" ]]; then
      "$NODE_BIN" "$OWNER_HELPER" assert-unit-file "$BODHI_DIR" "$LABEL" "$TARGET" >/dev/null 2>&1 || restoration_failed=1
    fi
    if [ "$restoration_failed" -eq 0 ]; then
      if [[ -n "$PREVIOUS" ]]; then
        install -m "$PREVIOUS_MODE" "$PREVIOUS" "$TARGET" || restoration_failed=1
        systemctl --user daemon-reload >/dev/null 2>&1 || restoration_failed=1
        if [ "$WAS_ENABLED" -eq 0 ]; then systemctl --user disable "$UNIT" >/dev/null 2>&1 || true; fi
        if [ "$WAS_ACTIVE" -eq 1 ] && [ "$restoration_failed" -eq 0 ]; then
          systemctl --user start "$UNIT" >/dev/null 2>&1 || restoration_failed=1
          systemctl --user is-active --quiet "$UNIT" || restoration_failed=1
          "$NODE_BIN" "$OWNER_HELPER" assert-agent "$BODHI_DIR" "$LABEL" >/dev/null 2>&1 || restoration_failed=1
        fi
      elif [[ -e "$TARGET" ]]; then
        systemctl --user disable "$UNIT" >/dev/null 2>&1 || true
        rm -f -- "$TARGET" || restoration_failed=1
        systemctl --user daemon-reload >/dev/null 2>&1 || restoration_failed=1
      fi
    fi
  fi
  rm -f -- "$RENDERED"
  if [ "$restoration_failed" -ne 0 ]; then
    echo "Prior service could not be restored automatically; preserved unit: $PREVIOUS" >&2
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
if [ "$WAS_ACTIVE" -eq 1 ]; then
  systemctl --user stop "$UNIT"
fi
mkdir -p "$(dirname "$TARGET")"
install -m 0644 "$RENDERED" "$TARGET"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null
systemctl --user restart "$UNIT"

# Linger keeps the user manager, and so BODHI, running without an open login
# session. It needs no root for your own account on a default polkit setup.
if [[ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || true)" != yes ]]; then
  if ! loginctl enable-linger "$(id -un)" >/dev/null 2>&1; then
    echo "warning: could not enable linger; BODHI stops when your last session ends. Fix: sudo loginctl enable-linger $(id -un)" >&2
  fi
fi

for _ in $(seq 1 "$TIMEOUT"); do
  if "$NODE_BIN" "$OWNER_HELPER" assert "$BODHI_DIR" "$LABEL" "$PORT_VALUE" >/dev/null 2>&1 \
    && systemctl --user is-active --quiet "$UNIT" \
    && curl -fsS --max-time 2 "http://localhost:$PORT_VALUE/health" >/dev/null 2>&1; then
    COMMITTED=1
    echo "BODHI systemd user unit verified: $UNIT"
    echo "Logs: journalctl --user -u $UNIT -f"
    exit 0
  fi
  sleep 1
done
echo "BODHI systemd user unit did not become healthy; restoring its prior registration. Inspect: journalctl --user -u $UNIT -n 100" >&2
exit 1
