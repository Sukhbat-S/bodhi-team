import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type ProcessIdentity = { pid: number; ppid: number; started: string; executable: string; command: string; cwd: string };
const systemEnv = { ...process.env, LC_ALL: "C", TZ: "UTC" };
function command(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: "utf8", env: systemEnv, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function physical(path: string): string | null { try { return realpathSync.native(path); } catch { return null; } }
function within(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
function word(value: string, target: string): boolean {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(value);
}

export function launchAgentOwned(output: string, root: string): boolean {
  const cwd = /^\tworking directory = (.+)$/m.exec(output)?.[1];
  const program = /^\tprogram = (.+)$/m.exec(output)?.[1];
  const block = /^\targuments = \{\r?\n([\s\S]*?)^\t\}/m.exec(output)?.[1];
  const args = block?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  const runner = physical(join(root, "scripts/run-server.sh"));
  const shell = program ? physical(program) : null;
  const systemShells = [physical("/bin/bash"), physical("/bin/sh")].filter(Boolean);
  return Boolean(runner && shell && systemShells.includes(shell) && cwd && physical(cwd) === root
    && args.length === 2 && physical(args[0]) === shell && physical(args[1]) === runner);
}

export function processOwned(info: ProcessIdentity, root: string): boolean {
  if (!within(root, info.cwd) || /(?:^|\s)(?:-e|--eval|-p|--print)(?:=|\s|$)/.test(info.command)) return false;
  const server = join(root, "apps/server"); const dashboard = join(root, "apps/dashboard");
  const executable = basename(info.executable);
  // dash is Ubuntu's /bin/sh, so a Linux `sh -c vite` dashboard resolves to it.
  if (!/^(?:node|tsx|npm(?: .*)?|sh|dash|bash)$/.test(executable)) return false;
  if (word(info.command, join(server, "src/index.ts")) || word(info.command, join(server, "dist/index.js"))) return true;
  if (info.cwd === root && word(info.command, "apps/server/src/index.ts")) return true;
  if (info.cwd === server && word(info.command, "src/index.ts")) return true;
  if (word(info.command, join(root, "node_modules/vite/bin/vite.js")) && (info.cwd === root || info.cwd === dashboard)) return true;
  if ((info.cwd === root || info.cwd === server || info.cwd === dashboard) && /^npm run dev(?:\s|$)/.test(info.command)) return true;
  return info.cwd === dashboard && /^(?:\/bin\/)?sh -c vite(?:\s|$)/.test(info.command);
}

// Linux `ps -o comm=` reports the main thread's name, which Node 24 sets to "MainThread";
// the executable's path is the stable identity there, as `comm` is on macOS.
// A binary replaced while it runs (Node upgraded under a live server) reads "<path> (deleted)".
export function linuxExecutablePath(link: string): string {
  const suffix = " (deleted)";
  return link.endsWith(suffix) ? link.slice(0, -suffix.length) : link;
}
function executableOf(pid: number): string {
  return process.platform === "linux" ? linuxExecutablePath(readlinkSync(`/proc/${pid}/exe`)) : command("ps", ["-p", String(pid), "-o", "comm="]);
}
export function readProcess(pid: number): ProcessIdentity | null {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    const cwd = command("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((line) => line.startsWith("n"))?.slice(1);
    if (!cwd) return null;
    return { pid, ppid: Number(command("ps", ["-p", String(pid), "-o", "ppid="])),
      started: command("ps", ["-p", String(pid), "-o", "lstart="]),
      executable: executableOf(pid),
      command: command("ps", ["-p", String(pid), "-o", "command="]), cwd: physical(cwd) ?? cwd };
  } catch { return null; }
}

function listeners(port: number): number[] {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", env: systemEnv });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error(`unable to inspect listener ownership on port ${port}`);
  return [...new Set(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
}

function loadedAgent(label: string): string | null {
  const result = spawnSync("launchctl", ["print", `gui/${process.getuid!()}/${label}`], { encoding: "utf8", env: systemEnv });
  if (result.status === 0) return result.stdout;
  if (/could not find (?:service|domain)|not found/i.test(result.stderr)) return null;
  throw new Error(`unable to verify loaded LaunchAgent ${label}`);
}
export function assertLaunchAgentOwner(root: string, label: string, platform = process.platform): boolean {
  if (platform !== "darwin") return false;
  const loaded = loadedAgent(label);
  if (loaded === null) return false;
  if (!launchAgentOwned(loaded, root)) throw new Error(`refusing to replace foreign LaunchAgent ${label}`);
  return true;
}
// Linux (including WSL2 with systemd): a per-user unit named after the label plays the LaunchAgent's role.
// install-systemd-user-service.sh renders exactly one WorkingDirectory and one Exec line; anything else is foreign.
const unitName = (label: string): string => `${label}.service`;
function systemdEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...systemEnv };
  const runtimeDir = `/run/user/${process.getuid!()}`;
  if (!env.XDG_RUNTIME_DIR && existsSync(runtimeDir)) env.XDG_RUNTIME_DIR = runtimeDir;
  return env;
}
export function systemdUnitOwned(text: string, root: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const workingDirectories = lines.filter((line) => line.startsWith("WorkingDirectory=")).map((line) => line.slice("WorkingDirectory=".length));
  const execLines = lines.filter((line) => /^Exec[A-Za-z]*=/.test(line));
  const start = execLines.length === 1 ? /^ExecStart=\/bin\/bash "([^"]+)"$/.exec(execLines[0]) : null;
  const runner = physical(join(root, "scripts/run-server.sh"));
  return Boolean(runner && start && workingDirectories.length === 1 && physical(workingDirectories[0]) === root && physical(start[1]) === runner);
}
function loadedUnit(label: string): { fragmentPath: string; dropInPaths: string } | null {
  const result = spawnSync("systemctl", ["--user", "show", unitName(label), "--property=LoadState,FragmentPath,DropInPaths", "--no-pager"], { encoding: "utf8", env: systemdEnv() });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
  if (result.error || result.status !== 0) {
    // No systemd, or no user manager for this login: no unit can own the service.
    if (/Failed to connect to|not been booted with systemd|System has not been booted|\$XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS/i.test(result.stderr ?? "")) return null;
    throw new Error(`unable to verify systemd user unit ${unitName(label)}`);
  }
  const properties = new Map(result.stdout.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const));
  const state = properties.get("LoadState");
  if (state === "not-found" || state === "masked") return null;
  if (state !== "loaded") throw new Error(`unable to verify systemd user unit ${unitName(label)}`);
  return { fragmentPath: properties.get("FragmentPath") ?? "", dropInPaths: properties.get("DropInPaths") ?? "" };
}
export function assertSystemdUnitOwner(root: string, label: string, platform = process.platform): boolean {
  if (platform !== "linux") return false;
  const unit = loadedUnit(label);
  if (unit === null) return false;
  if (unit.dropInPaths.trim() || !unit.fragmentPath || !existsSync(unit.fragmentPath) || lstatSync(unit.fragmentPath).isSymbolicLink()
    || !systemdUnitOwned(readFileSync(unit.fragmentPath, "utf8"), root)) throw new Error(`refusing to replace foreign systemd user unit ${unitName(label)}`);
  return true;
}
export function assertUnitFileOwner(path: string, root: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error("refusing a symlinked systemd unit target");
  if (!systemdUnitOwned(readFileSync(path, "utf8"), root)) throw new Error("refusing to overwrite a foreign systemd user unit");
}
export function assertPlistOwner(path: string, root: string, label: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error("refusing a symlinked LaunchAgent target");
  const data = JSON.parse(command("plutil", ["-convert", "json", "-o", "-", path])) as { Label?: string; WorkingDirectory?: string; ProgramArguments?: string[] };
  const args = data.ProgramArguments;
  const runner = physical(join(root, "scripts/run-server.sh"));
  if (data.Label !== label || !data.WorkingDirectory || physical(data.WorkingDirectory) !== root
    || !runner || !args || args.length !== 2 || physical(args[0]) !== physical("/bin/bash") || physical(args[1]) !== runner) {
    throw new Error("refusing to overwrite a foreign LaunchAgent plist");
  }
}
export function assertPortsOwnedOrFree(root: string, ports: number[]): void {
  for (const port of ports) for (const pid of listeners(port)) {
    const info = readProcess(pid);
    if (!info || !processOwned(info, root)) throw new Error(`port ${port} is occupied by a foreign or unverifiable process; left untouched`);
  }
}
function sameProcess(before: ProcessIdentity, after: ProcessIdentity | null): boolean {
  return Boolean(after && before.pid === after.pid && before.started === after.started && before.executable === after.executable && before.command === after.command && before.cwd === after.cwd);
}
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function stopOwnedServices(root: string, label: string, ports: number[], platform = process.platform): Promise<{ signalled: number; skippedForeign: number }> {
  const hasAgent = assertLaunchAgentOwner(root, label, platform);
  const hasUnit = assertSystemdUnitOwner(root, label, platform);
  const selected = new Map<number, ProcessIdentity>(); let skippedForeign = 0;
  const add = (pid: number): void => {
    let info = readProcess(pid);
    while (info && info.pid !== process.pid && info.pid !== process.ppid && processOwned(info, root) && !selected.has(info.pid)) {
      selected.set(info.pid, info); info = readProcess(info.ppid);
    }
  };
  const pidFiles = [join(root, "logs/server.pid"), join(root, "logs/dashboard.pid")];
  for (const file of pidFiles) {
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue;
    const text = readFileSync(file, "utf8").trim();
    if (!/^[1-9]\d*$/.test(text)) { skippedForeign++; continue; }
    const info = readProcess(Number(text));
    if (!info) continue;
    const startedAt = Date.parse(`${info.started} UTC`);
    if (!processOwned(info, root) || !Number.isFinite(startedAt) || startedAt > lstatSync(file).mtimeMs + 1000) { skippedForeign++; continue; }
    add(info.pid);
  }
  for (const port of ports) for (const pid of listeners(port)) {
    const info = readProcess(pid);
    if (info && processOwned(info, root)) add(pid); else skippedForeign++;
  }
  if (hasAgent) {
    // Re-read immediately before mutation, rather than trusting an earlier label lookup.
    assertLaunchAgentOwner(root, label, platform);
    command("launchctl", ["bootout", `gui/${process.getuid!()}/${label}`]);
  }
  if (hasUnit) {
    assertSystemdUnitOwner(root, label, platform);
    execFileSync("systemctl", ["--user", "stop", unitName(label)], { encoding: "utf8", env: systemdEnv(), stdio: ["ignore", "pipe", "pipe"] });
  }
  const identities = [...selected.values()];
  for (const info of identities) if (sameProcess(info, readProcess(info.pid))) {
    try { process.kill(info.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  for (let attempt = 0; attempt < 30 && identities.some((info) => sameProcess(info, readProcess(info.pid))); attempt++) await delay(100);
  for (const info of identities) {
    const current = readProcess(info.pid);
    if (sameProcess(info, current) && current && processOwned(current, root)) {
      try { process.kill(info.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  }
  for (const file of pidFiles) {
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue;
    const text = readFileSync(file, "utf8").trim();
    if (/^[1-9]\d*$/.test(text) && selected.has(Number(text)) && !readProcess(Number(text))) unlinkSync(file);
  }
  for (const port of ports) for (const pid of listeners(port)) {
    const current = readProcess(pid);
    if (current && processOwned(current, root)) throw new Error(`owned listener on port ${port} did not stop; refusing false success`);
  }
  return { signalled: identities.length, skippedForeign };
}

async function main(): Promise<void> {
  const [action, rootArg, label, ...portArgs] = process.argv.slice(2);
  if (!rootArg || !label || !/^com\.bodhi(?:\.[a-z0-9][a-z0-9-]*)?\.server$/.test(label)) throw new Error("usage: service-ownership.ts <assert|stop|assert-agent> <root> <label> [ports...]");
  const root = realpathSync(rootArg); const ports = portArgs.map(Number);
  if (action === "assert-plist") {
    if (portArgs.length !== 1) throw new Error("assert-plist requires one target");
    assertPlistOwner(portArgs[0], root, label); return;
  }
  if (action === "assert-unit-file") {
    if (portArgs.length !== 1) throw new Error("assert-unit-file requires one target");
    assertUnitFileOwner(portArgs[0], root); return;
  }
  if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error("invalid service port");
  if (action === "assert") { assertLaunchAgentOwner(root, label); assertSystemdUnitOwner(root, label); assertPortsOwnedOrFree(root, ports); }
  else if (action === "assert-free") {
    for (const port of ports) if (listeners(port).length) throw new Error(`port ${port} remains occupied; refusing startup`);
  }
  else if (action === "assert-agent") { assertLaunchAgentOwner(root, label); assertSystemdUnitOwner(root, label); }
  else if (action === "stop") console.log(JSON.stringify(await stopOwnedServices(root, label, ports)));
  else throw new Error("unknown service ownership action");
}
if (process.argv[1] && physical(process.argv[1]) === physical(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
