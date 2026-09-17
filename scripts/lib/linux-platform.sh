#!/bin/bash
# Read-only Linux and WSL2 environment probes for the Linux bootstrap, upgrade,
# systemd user-service installer and start.sh. Nothing here changes system
# state; the fix texts are printed for the owner to review and run.
# File arguments exist so tests can probe fixtures instead of the live system.

# Prints wsl2, wsl1 or none.
bodhi_wsl_kind() {
  local file="${1:-/proc/version}" text=""
  [[ -r "$file" ]] && text="$(cat "$file" 2>/dev/null || true)"
  if [[ "$text" == *-microsoft-standard* || "$text" == *WSL2* ]]; then
    echo wsl2
  elif [[ "$text" == *Microsoft* ]]; then
    # WSL1 reports a capitalised Microsoft kernel build and has no real kernel.
    echo wsl1
  elif [[ "$text" == *microsoft* ]]; then
    echo wsl2
  elif [[ $# -eq 0 && -n "${WSL_DISTRO_NAME:-}" ]]; then
    # A custom WSL2 kernel may drop the marker; the WSL launcher still sets this.
    echo wsl2
  else
    echo none
  fi
}

# Prints "<ID> <VERSION_ID> <VERSION_CODENAME>" from os-release, or nothing.
bodhi_os_release() {
  local file="${1:-/etc/os-release}"
  [[ -r "$file" ]] || return 0
  (
    ID="" VERSION_ID="" VERSION_CODENAME=""
    # shellcheck disable=SC1090
    . "$file"
    printf '%s %s %s\n' "${ID:-unknown}" "${VERSION_ID:-unknown}" "${VERSION_CODENAME:-unknown}"
  )
}

# Prints yes when /etc/wsl.conf enables systemd in its [boot] section, else no.
bodhi_wsl_systemd_configured() {
  local file="${1:-/etc/wsl.conf}"
  [[ -r "$file" ]] || { echo no; return 0; }
  awk '
    { line = $0; sub(/[#;].*$/, "", line); gsub(/[[:space:]]/, "", line) }
    line == "" { next }
    line ~ /^\[.*\]$/ { section = tolower(line); next }
    section == "[boot]" && tolower(substr(line, 1, 8)) == "systemd=" { value = tolower(substr(line, 9)) }
    END { print (value == "true" ? "yes" : "no") }
  ' "$file"
}

# Succeeds when PID 1 of this Linux environment is systemd.
# shellcheck disable=SC2120 # the optional argument is a test fixture path
bodhi_pid1_is_systemd() {
  [[ "$(cat "${1:-/proc/1/comm}" 2>/dev/null || true)" == systemd ]]
}

# A stripped environment (env -i) loses the user bus location; restore the
# standard per-user runtime directory when it exists.
bodhi_export_user_runtime_dir() {
  local runtime_dir
  runtime_dir="/run/user/$(id -u)"
  if [[ -z "${XDG_RUNTIME_DIR:-}" && -d "$runtime_dir" ]]; then
    export XDG_RUNTIME_DIR="$runtime_dir"
  fi
  return 0
}

# Succeeds when a systemd user manager answers for the current user.
bodhi_systemd_user_available() {
  bodhi_pid1_is_systemd || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  bodhi_export_user_runtime_dir
  systemctl --user show-environment >/dev/null 2>&1
}

bodhi_print_wsl_systemd_fix() {
  cat <<'EOF'
Enable systemd for this WSL distribution. Edit /etc/wsl.conf (for example: sudo nano /etc/wsl.conf)
so it contains these sections, keeping any other lines:
  [boot]
  systemd=true

  [interop]
  appendWindowsPath=false
appendWindowsPath=false keeps Windows node, npm and git off the Linux PATH; Windows programs
still run by full path (for example /mnt/c/Windows/System32/cmd.exe). Then, from Windows PowerShell:
  wsl.exe --shutdown
and open the distribution again (wsl.exe -d Ubuntu-24.04). Without systemd, BODHI still runs
through scripts/start.sh; see docs/windows-wsl2.md ("Running without systemd").
EOF
}

# Key fingerprints, checked 17 Sep 2026. Neither vendor prints the full fingerprint on its current
# install page (wiki.postgresql.org/wiki/Apt, postgresql.org/download/linux/ubuntu; the README and
# DEV_README of github.com/nodesource/distributions), so they are pinned from the keys served at the
# official URLs below, which match keyserver.ubuntu.com and the short PGDG key id ACCC4CF8 in the URL.
# A mismatch installs nothing, so apt refuses that repository.
bodhi_print_linux_prerequisites() {
  cat <<'EOF'
Install the Ubuntu prerequisites (review each line before running it):
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg build-essential python3 git jq lsof bubblewrap
  # Signing keys are downloaded as you, checked against their full fingerprint, and only a match is installed.
  KEYS="$(mktemp -d)"
  # PostgreSQL Global Development Group (PGDG) key B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8, for PostgreSQL 18 and pgvector
  curl -fsSL -o "$KEYS/pgdg.asc" https://www.postgresql.org/media/keys/ACCC4CF8.asc
  if [ "$(gpg --show-keys --with-colons "$KEYS/pgdg.asc" | awk -F: '$1 == "fpr" { print $10; exit }')" = B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]; then sudo install -D -m 0644 "$KEYS/pgdg.asc" /etc/apt/keyrings/pgdg.asc; else echo "PGDG key fingerprint mismatch: not installed" >&2; fi
  . /etc/os-release
  echo "deb [signed-by=/etc/apt/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
  # NodeSource key 6F71 F525 2828 41EE DAF8 51B4 2F59 B5F9 9B1B E0B4, for Node.js 24 with npm 11
  curl -fsSL -o "$KEYS/nodesource.asc" https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
  if [ "$(gpg --show-keys --with-colons "$KEYS/nodesource.asc" | awk -F: '$1 == "fpr" { print $10; exit }')" = 6F71F525282841EEDAF851B42F59B5F99B1BE0B4 ]; then sudo install -D -m 0644 "$KEYS/nodesource.asc" /etc/apt/keyrings/nodesource.asc; else echo "NodeSource key fingerprint mismatch: not installed" >&2; fi
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_24.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
  rm -rf "$KEYS"
  sudo apt-get update
  sudo apt-get install -y postgresql-18 postgresql-18-pgvector nodejs
EOF
}

bodhi_print_postgres_access_fix() {
  cat <<'EOF'
Prepare local PostgreSQL 18 for this Linux account (review before running):
  # Start the cluster. systemd starts it automatically; without systemd run this once per WSL start.
  sudo service postgresql start
  # A local superuser role named after your Linux account, as Homebrew creates on macOS.
  # It signs in through the local socket (peer); the bootstrap gives it a generated password for loopback TCP.
  sudo -u postgres createuser --superuser "$(id -un)"
EOF
}

bodhi_print_postgres_hba_fix() {
  cat <<'EOF'
Loopback TCP must require scram-sha-256 for your role. Keep PGDG's defaults, which are:
  listen_addresses = 'localhost'        (postgresql.conf)
  local all all peer                    (pg_hba.conf)
  host all all 127.0.0.1/32 scram-sha-256
  host all all ::1/128 scram-sha-256
  # Inspect, then remove any trust, password, md5 or non-loopback host rule that matches your role:
  sudo -u postgres psql -Atc 'SELECT line_number, type, database, user_name, address, auth_method, error FROM pg_hba_file_rules'
  sudoedit "$(sudo -u postgres psql -Atqc 'SHOW hba_file')"
  sudo -u postgres psql -Atqc 'SELECT pg_reload_conf()'
EOF
}
