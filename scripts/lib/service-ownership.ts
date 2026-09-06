import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
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
  if (!/^(?:node|tsx|npm(?: .*)?|sh|bash)$/.test(executable)) return false;
  if (word(info.command, join(server, "src/index.ts")) || word(info.command, join(server, "dist/index.js"))) return true;
  if (info.cwd === root && word(info.command, "apps/server/src/index.ts")) return true;
  if (info.cwd === server && word(info.command, "src/index.ts")) return true;
  if (word(info.command, join(root, "node_modules/vite/bin/vite.js")) && (info.cwd === root || info.cwd === dashboard)) return true;
  if ((info.cwd === root || info.cwd === server || info.cwd === dashboard) && /^npm run dev(?:\s|$)/.test(info.command)) return true;
  return info.cwd === dashboard && /^(?:\/bin\/)?sh -c vite(?:\s|$)/.test(info.command);
}

export function readProcess(pid: number): ProcessIdentity | null {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    const cwd = command("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((line) => line.startsWith("n"))?.slice(1);
    if (!cwd) return null;
    return { pid, ppid: Number(command("ps", ["-p", String(pid), "-o", "ppid="])),
      started: command("ps", ["-p", String(pid), "-o", "lstart="]),
      executable: command("ps", ["-p", String(pid), "-o", "comm="]),
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
  if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error("invalid service port");
  if (action === "assert") { assertLaunchAgentOwner(root, label); assertPortsOwnedOrFree(root, ports); }
  else if (action === "assert-free") {
    for (const port of ports) if (listeners(port).length) throw new Error(`port ${port} remains occupied; refusing startup`);
  }
  else if (action === "assert-agent") assertLaunchAgentOwner(root, label);
  else if (action === "stop") console.log(JSON.stringify(await stopOwnedServices(root, label, ports)));
  else throw new Error("unknown service ownership action");
}
if (process.argv[1] && physical(process.argv[1]) === physical(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
