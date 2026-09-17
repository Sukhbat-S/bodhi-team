# BODHI on Windows through WSL2

On Windows, BODHI runs inside a WSL2 Ubuntu distribution, not natively. PostgreSQL 18 with pgvector, the Node 24 native modules, the POSIX install scripts and the service manager all run there unchanged, and the server stays on loopback. Your harness can run inside the same distribution (topology A) or on Windows (topology B).

Target: Windows 11 on x64 with the current WSL 2 from the Microsoft Store and Ubuntu 24.04 (22.04 is also accepted). The Linux scripts were exercised in Ubuntu 24.04 containers; a real Windows machine has not yet run this guide end to end, and Windows on Arm is untested.

Throughout this guide the distribution is `Ubuntu-24.04`. Every `wsl.exe` command names it with `-d`, because the default distribution may belong to something else (Docker Desktop installs one called `docker-desktop`). Making Ubuntu the default is optional: `wsl.exe --set-default Ubuntu-24.04`.

## 1. Prepare Windows

1. Finish pending Windows updates and restart first.
2. In PowerShell (WSL may ask for elevation while updating):

   ```powershell
   wsl.exe --update
   wsl.exe --install -d Ubuntu-24.04
   wsl.exe -l -v                  # Ubuntu-24.04 must show VERSION 2
   ```

   `--install` asks you to create a Linux user. Open the distribution with `wsl.exe -d Ubuntu-24.04`. Run everything below in that Linux shell unless a step says PowerShell.

## 2. Configure the distribution

Edit `/etc/wsl.conf` (for example `sudo nano /etc/wsl.conf`) so it contains these sections, keeping any other lines already there:

```ini
[boot]
systemd=true

[interop]
appendWindowsPath=false
```

- `systemd=true` lets BODHI run as a systemd user service that restarts on failure and starts with the distribution. Ubuntu images often enable it already.
- `appendWindowsPath=false` keeps Windows `node`, `npm` and `git` off the Linux `PATH`, so nothing Windows-side can build or run BODHI by accident; the bootstrap refuses such binaries. The trade-off: Windows programs are no longer found by bare name inside WSL; call them by full path, for example `/mnt/c/Windows/System32/cmd.exe`. WSL interop itself keeps working.

Apply the change from PowerShell, then reopen the distribution:

```powershell
wsl.exe --shutdown
wsl.exe -d Ubuntu-24.04
```

Check: `ps -p 1 -o comm=` prints `systemd`, and `command -v node npm git` prints nothing under `/mnt`.

## 3. Git line endings

Inside WSL, before cloning anything:

```bash
git config --global core.autocrlf false
```

Windows Git commonly converts line endings to CRLF. A shell script with CRLF fails with `bash\r: No such file or directory`. Never clone BODHI with Windows Git, and never copy a checkout from a Windows folder into WSL. If it happened, delete that copy and extract or clone again inside WSL. Check a checkout with `grep -c $'\r' scripts/start.sh`, which must print `0`.

## 4. Keep BODHI inside the Linux filesystem

Download the release package and SHA256SUMS from this repository's Releases page inside WSL, verify the checksum with `sha256sum`, and extract it into a new directory under your Linux home, for example `~/bodhi`. Do not use `/mnt/c` or any other Windows drive:

- Windows drives cannot keep `.env` private. Files there report broad permissions, and the MCP adapter refuses an environment file readable by others.
- npm installs and PostgreSQL are many times slower across the Windows file bridge.
- Case-insensitive names, CRLF edits from Windows tools and missing file-change events break builds in ways that are hard to diagnose.

The bootstrap refuses a checkout under `/mnt`.

## 5. Prerequisites

Review each line before running it. These install build tools, `jq`, `lsof` and bubblewrap from Ubuntu, PostgreSQL 18 and pgvector from the PostgreSQL Global Development Group (PGDG), and Node.js 24 with npm 11 from NodeSource. The two signing keys are downloaded as you, not as root, and installed only when their full fingerprints match. Neither vendor prints the full fingerprint on its current install page, so these are pinned from the keys served at the official URLs, cross-checked with keyserver.ubuntu.com on 17 Sep 2026. On a mismatch nothing is installed and apt refuses that repository; stop and report it. The bootstrap prints this same block when something is missing.

```bash
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
```

Then give your Linux account a local database role, as Homebrew does on macOS:

```bash
# Start the cluster. systemd starts it automatically; without systemd run this once per WSL start.
sudo service postgresql start
# A local superuser role named after your Linux account, as Homebrew creates on macOS.
# It signs in through the local socket (peer); the bootstrap gives it a generated password for loopback TCP.
sudo -u postgres createuser --superuser "$(id -un)"
```

Unlike Homebrew on macOS, loopback TCP is never trusted here. WSL2 forwards loopback ports to Windows, so any Windows program could otherwise connect as your role. Keep PGDG's defaults:

```
listen_addresses = 'localhost'        (postgresql.conf)
local all all peer                    (pg_hba.conf)
host all all 127.0.0.1/32 scram-sha-256
host all all ::1/128 scram-sha-256
```

Setup commands reach PostgreSQL through the local socket, which Windows cannot use. With `--apply`, the bootstrap generates a random password for your role and sends PostgreSQL only its SCRAM-SHA-256 verifier. It stores the password only in `DATABASE_URL` inside `.env` (mode 0600) and never prints it. The BODHI server, backups and upgrades connect over loopback TCP with it; upgrades carry `.env` over unchanged. The preflight refuses to continue if PostgreSQL listens beyond loopback, if any host rule could admit your role to the BODHI database without scram-sha-256 on loopback, if loopback TCP accepts your role without a password, or if the role already has a password that another installation may rely on.

## 6. Preflight and install

From the extracted package:

```bash
bash scripts/bootstrap-personal-linux.sh --owner "Your name" --assistant "BODHI" --database bodhi_personal --port 4000 --expected-manifest-sha256 MANIFEST_HASH_FROM_RELEASE
```

The dry run changes nothing. Besides the macOS checks (sealed release, manifest identity, no existing `.env`, `AGENTS.md` or database, a free and unowned port), it reports the WSL generation, the Ubuntu release, whether systemd runs, and the exact fix for anything missing. It refuses WSL1, the `docker-desktop` distribution, a checkout under `/mnt`, Windows binaries on `PATH`, and a host where bubblewrap cannot create the dependency-build sandbox.

After reviewing it, append `--apply --defer-voyage`. Dependencies are installed and built inside a bubblewrap sandbox that sees only the package directory and read-only system paths, before any private file exists. Only `npm ci` reaches the network; the native module compiles offline from source, which takes about a minute. The script creates the database, `AGENTS.md`, `.env` (mode 0600) and a checksummed backup, and leaves the runtime stopped.

Then add your own Voyage key:

```bash
bash scripts/activate-personal-voyage-linux.sh
```

It prompts without echo (or reads `VOYAGE_API_KEY` from this terminal's environment), validates the key with Voyage, stores it only in `.env`, and starts BODHI.

## 7. The service

### With systemd

`scripts/start.sh` installs and starts a systemd user unit named after the instance, for example `com.bodhi.bodhi-personal.server.service`. It restarts on failure, logs to the journal, and enables linger so it keeps running without an open terminal. Useful commands:

```bash
systemctl --user status com.bodhi.bodhi-personal.server.service
journalctl --user -u com.bodhi.bodhi-personal.server.service -f
bash scripts/stop.sh        # stops the unit and any owned process
bash scripts/start.sh       # reinstalls the unit if needed, starts it and waits for health
```

To install or refresh the unit on its own: `bash scripts/install-systemd-user-service.sh`. It refuses to replace a unit with the same name that points at another checkout.

### Running without systemd

`scripts/start.sh` starts BODHI as a detached process with logs in `logs/server.log`. It survives closing the terminal but not a WSL shutdown or a Windows restart. Start PostgreSQL first in each WSL session:

```bash
sudo service postgresql start
bash scripts/start.sh
```

To start it at Windows sign-in, create a Task Scheduler task (Task Scheduler, Create Task, Trigger "At log on" for your account) with two actions, where `BODHI_ROOT` is the absolute Linux path of your checkout:

1. Program `wsl.exe`, arguments `-d Ubuntu-24.04 -u root --exec /usr/sbin/service postgresql start`
2. Program `wsl.exe`, arguments `-d Ubuntu-24.04 --exec /bin/bash BODHI_ROOT/scripts/start.sh`

### Keeping the distribution running

WSL can stop a distribution shortly after the last Windows process using it exits, and BODHI stops with it. Check on your machine: close every WSL terminal, wait a minute, then run `wsl.exe -l -v` in PowerShell. If Ubuntu-24.04 shows `Stopped`, BODHI starts again the next time anything opens the distribution: a terminal, the Task Scheduler task above, or a Windows-side harness launching the MCP server (topology B). In that last case the first tool calls can fail while the service boots; retry after a few seconds.

Windows sleep suspends the WSL virtual machine, and BODHI resumes with it. Scheduled maintenance tolerates the gap and catches up on wake.

## 8. Harness

Run the installer inside WSL, from the BODHI checkout.

### Topology A: harness inside WSL (recommended for Claude Code and Codex CLI)

Install Codex CLI and Claude Code inside the distribution by following their Linux instructions, sign in there, and start them from a Linux shell. Skill symlinks, hooks and the stdio MCP server are then Linux-native, exactly as on macOS:

```bash
npm run harness:install                        # dry run; prints every change and configuration block
npm run harness:install -- --apply
```

The installer auto-detects WSL. Run the printed `claude mcp add` command and merge the printed Codex blocks in the same Linux shell.

### Topology B: Codex or Claude Code on Windows

Use this when the harness is a Windows program, for example the Codex app or its bundled CLI. BODHI, its `.env` and the hooks stay inside WSL; Windows reaches them only through `wsl.exe -d Ubuntu-24.04`.

```bash
node scripts/install-harness.mjs --harness codex --platform windows-host             # dry run
node scripts/install-harness.mjs --harness codex --platform windows-host --apply
```

Use `--harness claude-code` or omit `--harness` for both. The installer:

- copies the skills into `%USERPROFILE%\.agents\skills` (Codex) and `%USERPROFILE%\.claude\skills` (Claude Code), and Claude Code agent cards into `%USERPROFILE%\.claude\agents`. Copies, because Windows cannot follow symlinks stored in the WSL filesystem. Each copy carries a `.bodhi-harness-copy` marker; only marked copies are refreshed or pruned. Re-run it after every BODHI upgrade.
- finds `%USERPROFILE%` through WSL interop. If that fails, pass `--windows-home` with its `/mnt` path.
- prints the Windows `config.toml` and `hooks.json` blocks for Codex, and the `claude mcp add` command and `settings.json` hooks for Claude Code.

The printed MCP registration has this shape (Codex, `%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.bodhi]
command = "wsl.exe"
args = ["-d", "Ubuntu-24.04", "--exec", "/usr/bin/env", "BODHI_ENV_FILE=BODHI_ROOT/.env", "BODHI_NODE=/usr/bin/node", "/bin/bash", "BODHI_ROOT/integrations/codex-plugin/bodhi/mcp/launch.sh"]
```

It runs the same bundled MCP launcher as every other topology. `--exec` starts the command without a Linux shell, so no argument is parsed twice. `/usr/bin/env` passes `BODHI_ENV_FILE` and a pinned Linux `BODHI_NODE`, which WSL would not forward from Windows. Every word is free of quotes and spaces, so the same line works from TOML, JSON, PowerShell and cmd. For this reason topology B needs a checkout path made only of letters, digits and `. _ - + @`; a path such as `~/bodhi` qualifies. The Codex plugin alternative does not work from Windows; use this block.

Hooks run inside WSL too. They receive Windows paths as the working directory, so the identity hook reports that path as the project, and the compaction note has no Git state.

## 9. Verify

In WSL:

```bash
curl -fsS http://localhost:4000/health
systemctl --user is-active com.bodhi.bodhi-personal.server.service   # systemd only
```

In PowerShell, through WSL localhost forwarding:

```powershell
curl.exe -fsS http://localhost:4000/health
```

Then start a fresh Codex task or Claude Code session in the topology you chose. Confirm the `bodhi` MCP server is connected (`claude mcp list`, or the Codex MCP status), that it lists 24 tools, and that `get_substrate_status` and `search_memories` complete. `search_memories` needs the Voyage activation from step 6.

## Troubleshooting

**systemd is off.** `ps -p 1 -o comm=` does not print `systemd`: add `[boot] systemd=true` to `/etc/wsl.conf` and run `wsl.exe --shutdown` in PowerShell. The bootstrap preflight names this state. Until then, use "Running without systemd".

**`systemctl --user` says it cannot connect to the bus.** Open a new login shell (`wsl.exe -d Ubuntu-24.04`). Scripts run from a stripped environment restore `XDG_RUNTIME_DIR` themselves.

**Windows cannot reach `http://localhost:4000`.** BODHI binds 127.0.0.1 inside WSL. WSL's default NAT networking forwards loopback ports to Windows unless `localhostForwarding=false` is set under `[wsl2]` in `%USERPROFILE%\.wslconfig`. Remove that line, or set `networkingMode=mirrored` there, then run `wsl.exe --shutdown`. VPN and firewall software can also block the forwarding. Topology B does not depend on it: the MCP server runs inside WSL and talks to BODHI there.

**Windows-side harness shows the MCP server as failed.** Run the printed command in PowerShell: `wsl.exe -d Ubuntu-24.04 --exec /usr/bin/env BODHI_ENV_FILE=... BODHI_NODE=... /bin/bash .../launch.sh`. It should wait silently for input; stop it with Ctrl+C. `BODHI MCP startup failed` means `.env` is missing, is not mode 0600, or `BODHI_URL` is not loopback. A Node error means `BODHI_NODE` no longer points at Node 24; re-run the installer. A distribution error means the `-d` name differs from `wsl.exe -l -v`.

**`Host key verification failed` when a Windows agent clones from GitHub.** Windows OpenSSH has no saved github.com host key, and a non-interactive agent cannot accept one. Use HTTPS through the GitHub CLI login instead: `gh auth setup-git`, then clone `https://github.com/<owner>/<repo>.git`.

**Codex will not open any thread: "can't load config.toml" / invalid transport in `mcp_servers.<name>`.** An `[mcp_servers.<name>]` block has neither `command` nor `url`. Codex cannot repair its own config while it is broken: close Codex, back up `%USERPROFILE%\.codex\config.toml`, comment out that block, reopen. Before any agent edits `config.toml`, back it up and run `codex mcp list` afterwards; restore the backup on error.

**`bash\r: No such file or directory`.** CRLF line endings: see section 3.

**Refusing Windows binaries on the Linux PATH.** Install the Linux packages from section 5, set `appendWindowsPath=false`, and reopen the distribution.

**bubblewrap cannot create a sandbox.** Run `wsl.exe --update` in PowerShell and reopen the distribution. Do not run the bootstrap as root.

**Cannot reach local PostgreSQL.** Run the database role block in section 5. Without systemd, run `sudo service postgresql start` in each WSL session.

**The preflight refuses the PostgreSQL authentication rules.** Loopback TCP must require scram-sha-256 for your role:

```bash
# Inspect, then remove any trust, password, md5 or non-loopback host rule that matches your role:
sudo -u postgres psql -Atc 'SELECT line_number, type, database, user_name, address, auth_method, error FROM pg_hba_file_rules'
sudoedit "$(sudo -u postgres psql -Atqc 'SHOW hba_file')"
sudo -u postgres psql -Atqc 'SELECT pg_reload_conf()'
```

Keep the defaults shown in section 5, then run the preflight again.

**The role already has a password.** Another BODHI installation for this Linux account may use it. If none does, clear it with `sudo -u postgres psql -c 'ALTER ROLE "your-linux-user" PASSWORD NULL'` and run the preflight again.

**The default distribution is `docker-desktop`.** Use `wsl.exe -d Ubuntu-24.04` everywhere, or run `wsl.exe --set-default Ubuntu-24.04`. The bootstrap refuses to run inside `docker-desktop`.

**After sleep or a Windows restart BODHI is down.** With systemd, opening the distribution (`wsl.exe -d Ubuntu-24.04`) starts the unit again. Without systemd, use the Task Scheduler task above or run `scripts/start.sh`.

## Upgrading

Use the new package's Linux upgrade script, exactly like the macOS sealed-package path in the README:

```bash
node NEW/scripts/install-harness.mjs --unlink --root INSTALLED --apply
bash NEW/scripts/upgrade-personal-linux.sh --release NEW --target INSTALLED                                   # preflight
bash NEW/scripts/upgrade-personal-linux.sh --release NEW --target INSTALLED --expected-manifest-sha256 HASH --apply
```

It stops the systemd unit (or refuses an unmanaged listener), backs up the database and the unit file, swaps the tree, restarts, and verifies `/api/status`, rolling back on failure. For topology B, re-run `install-harness.mjs --platform windows-host --apply` afterwards to refresh the copied skills.
