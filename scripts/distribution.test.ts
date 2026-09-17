import {describe,it,expect} from "vitest";
import {cpSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {classifyReleasePath,ownerNeutralContentError,validatePersonalReleaseManifest} from "./lib/release-contract.js";
import {linuxExecutablePath,processOwned,systemdUnitOwned} from "./lib/service-ownership.js";
describe("distribution boundary",()=>{
 it.each([".env","data/records.json","backups/snapshot.sql","profiles/owner.json","../outside.json","auth.json"])("excludes private path %s",path=>expect(classifyReleasePath(path)).not.toBe("shared"));
 it("includes reviewed code and generic skills",()=>{expect(classifyReleasePath("apps/server/src/config.ts")).toBe("shared");expect(classifyReleasePath("templates/personal/skills/component-driven-ui/SKILL.md")).toBe("shared")});
 it("does not admit arbitrary reports",()=>expect(classifyReleasePath("reports/notes.md")).not.toBe("shared"));
 it.each([
  "templates/claude-code/CLAUDE.md.global-template",
  "templates/claude-code/agents/bodhi-impl.md",
  "templates/claude-code/hooks/precompact-checkpoint.sh",
  "templates/personal/skills/emil-design-eng/LICENSE",
  "templates/personal/skills/interface-review/references/accessibility-audit.md",
  "scripts/install-harness.mjs",
  "templates/codex/AGENTS.md.global-template",
  "templates/codex/config.snippet.toml",
  "scripts/harness-session-lifecycle.sh",
  "docs/dual-harness-orchestration.md",
  "docs/decisions/ADR-004-peer-harness-claude-code.md",
  "skill-evals/README.md",
  "skill-evals/evals/fire-verify-by-emission/prompt.md",
 ])("admits the reviewed harness surface %s",path=>expect(classifyReleasePath(path)).toBe("shared"));
 it.each([
  "scripts/bootstrap-personal-linux.sh",
  "scripts/upgrade-personal-linux.sh",
  "scripts/activate-personal-voyage-linux.sh",
  "scripts/install-systemd-user-service.sh",
  "scripts/lib/linux-platform.sh",
  "docs/windows-wsl2.md",
 ])("admits the reviewed Linux and WSL2 surface %s",path=>expect(classifyReleasePath(path)).toBe("shared"));
 it.each(["scripts/bootstrap-personal-windows.ps1","docs/windows-notes.md","configs/systemd/owner.service"])("does not admit unreviewed platform file %s",path=>expect(classifyReleasePath(path)).not.toBe("shared"));
 it("keeps every reviewed Linux and WSL2 file owner-neutral",()=>{
  for(const path of ["scripts/bootstrap-personal-linux.sh","scripts/upgrade-personal-linux.sh","scripts/activate-personal-voyage-linux.sh","scripts/install-systemd-user-service.sh","scripts/lib/linux-platform.sh","docs/windows-wsl2.md"])expect(ownerNeutralContentError(readFileSync(resolve(path))),path).toBeNull();
 });

 it.each([
  "templates/personal/skills/skill-evolution/SKILL.md",
  "templates/personal/skills/operational-debugging/SKILL.md",
  "skill-evals/evals/results/latest.json",
  "skill-evals/evals/fire-other-skill/prompt.md",
  "skill-evals/skills/research-chain",
  ".claude/skills/session-start",
  "CLAUDE.md",
 ])("keeps retired, generated or owner-local path %s outside the release",path=>expect(classifyReleasePath(path)).not.toBe("shared"));
});

describe("Linux release compatibility",()=>{
 const manifest=(platforms:string[])=>({contractVersion:1,releaseVersion:"v1.1.0-preview.3",sourceCommit:"a".repeat(40),sourceDirty:false,compatibility:{platforms,schemaFrom:0,schemaTo:0},artifacts:[{path:"README.md",sha256:"b".repeat(64)}],migrations:[]});
 it("accepts Linux x64 and arm64 targets",()=>expect(validatePersonalReleaseManifest(manifest(["darwin-arm64","linux-x64","linux-arm64"]))).toEqual([]));
 it("still rejects an unknown platform",()=>expect(validatePersonalReleaseManifest(manifest(["linux-riscv64"]))).not.toEqual([]));
 it("packs releases that declare the Linux targets",()=>expect(readFileSync(resolve("scripts/pack-release.mjs"),"utf8")).toContain("'linux-x64','linux-arm64'"));
});

describe("Linux and WSL2 platform probes",()=>{
 const dir=mkdtempSync(join(tmpdir(),"bodhi-linux-probe-"));
 const fixture=(name:string,text:string)=>{const path=join(dir,name);writeFileSync(path,text);return path;};
 const probe=(fn:string,...args:string[])=>execFileSync("bash",["-c",`. "$1"; shift; "$@"`,"_",resolve("scripts/lib/linux-platform.sh"),fn,...args],{encoding:"utf8",env:{PATH:process.env.PATH??""}}).trim();
 it("tells WSL2, WSL1 and plain Linux kernels apart",()=>{
  expect(probe("bodhi_wsl_kind",fixture("wsl2","Linux version 6.6.87-microsoft-standard-WSL2 (gcc) #1 SMP"))).toBe("wsl2");
  expect(probe("bodhi_wsl_kind",fixture("wsl1","Linux version 4.4.0-26100-Microsoft #1-Microsoft"))).toBe("wsl1");
  expect(probe("bodhi_wsl_kind",fixture("linux","Linux version 6.8.0-45-generic (buildd) #45-Ubuntu SMP"))).toBe("none");
 });
 it("reads the systemd switch only from the [boot] section",()=>{
  expect(probe("bodhi_wsl_systemd_configured",fixture("on","[user]\ndefault=owner\n\n[boot]\nsystemd = true # enabled\n"))).toBe("yes");
  expect(probe("bodhi_wsl_systemd_configured",fixture("other-section","[interop]\nsystemd=true\n"))).toBe("no");
  expect(probe("bodhi_wsl_systemd_configured",fixture("off","[boot]\nsystemd=false\n"))).toBe("no");
  expect(probe("bodhi_wsl_systemd_configured",join(dir,"absent"))).toBe("no");
 });
 it("parses the distribution release",()=>{
  expect(probe("bodhi_os_release",fixture("os-release",'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n'))).toBe("ubuntu 24.04 noble");
 });
 it("documents exactly the prerequisite and database commands the bootstrap prints",()=>{
  const guide=readFileSync(resolve("docs/windows-wsl2.md"),"utf8");
  for(const fn of ["bodhi_print_linux_prerequisites","bodhi_print_postgres_access_fix","bodhi_print_postgres_hba_fix"]){
   for(const line of probe(fn).split("\n").slice(1).map(l=>l.trim()).filter(Boolean))expect(guide,`${fn}: ${line}`).toContain(`\n${line}\n`);
  }
 });
});

describe("sealed-package upgraders",()=>{
 // An unpacked release has no node_modules. Before preview.3 the upgrader demanded a Node whose
 // better-sqlite3 loaded from that release, so it stopped before reading its arguments.
 it.each(["upgrade-personal-macos.sh","upgrade-personal-linux.sh"])("%s needs only Node 24 from a fresh package",script=>{
  const release=mkdtempSync(join(tmpdir(),"bodhi-fresh-release-"));
  cpSync(resolve("scripts"),join(release,"scripts"),{recursive:true});
  const result=spawnSync("bash",[join(release,"scripts",script)],{encoding:"utf8",env:{PATH:process.env.PATH??"",HOME:release,BODHI_NODE:process.execPath}});
  expect(result.stderr).not.toContain("cannot find a Node 24 runtime");
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("usage:");
 });
});

describe("Linux process identity",()=>{
 const root=realpathSync(resolve("."));
 it("keeps the executable path of a binary replaced while it runs",()=>{
  expect(linuxExecutablePath("/usr/bin/node (deleted)")).toBe("/usr/bin/node");
  expect(linuxExecutablePath("/usr/bin/node")).toBe("/usr/bin/node");
  expect(linuxExecutablePath("/opt/node (deleted)/bin/node")).toBe("/opt/node (deleted)/bin/node");
 });
 it("owns the server whose Node binary was upgraded underneath it",()=>{
  expect(processOwned({pid:10,ppid:1,started:"",executable:linuxExecutablePath("/usr/bin/node (deleted)"),command:"/usr/bin/node node_modules/tsx/dist/cli.mjs apps/server/src/index.ts",cwd:root},root)).toBe(true);
 });
 it("owns the dashboard's sh -c vite when /bin/sh is dash, and nothing else run by dash",()=>{
  const dashboard=join(root,"apps/dashboard");
  expect(processOwned({pid:11,ppid:1,started:"",executable:"/usr/bin/dash",command:"sh -c vite",cwd:dashboard},root)).toBe(true);
  expect(processOwned({pid:12,ppid:1,started:"",executable:"/usr/bin/dash",command:"sh -c curl example",cwd:dashboard},root)).toBe(false);
  expect(processOwned({pid:13,ppid:1,started:"",executable:"/usr/bin/zsh",command:"sh -c vite",cwd:dashboard},root)).toBe(false);
 });
});

describe("Linux bootstrap rollback",()=>{
 // Runs the real rollback function with PostgreSQL and node stubbed, so no database or container is needed.
 const rollback=(dropdbStatus:number)=>{
  const text=readFileSync(resolve("scripts/bootstrap-personal-linux.sh"),"utf8");
  const start=text.indexOf("rollback_fresh_install() {");
  const body=text.slice(start,text.indexOf("\n}\n",start)+3);
  const dir=mkdtempSync(join(tmpdir(),"bodhi-rollback-"));
  const script=`set -euo pipefail
LOG="${dir}/calls"
pg_admin() { printf '%s\\n' "$*" >> "$LOG"; if [[ "$1" == dropdb ]]; then return ${dropdbStatus}; fi; }
node() { :; }
BODHI_DIR="${dir}" LABEL=com.bodhi.test.server PORT_VALUE=4999 DATABASE_NAME=bodhi_test CURRENT_USER=owner
PRIVATE_BUILD_PROBE="" ENV_TMP="" ENV_CREATED=0 OWNER_INSTRUCTIONS_CREATED=0 COMPLETE=0 DATABASE_CREATED=1 PASSWORD_SET=1
${body}
trap rollback_fresh_install EXIT
false`;
  const result=spawnSync("bash",["-c",script],{encoding:"utf8"});
  return {status:result.status,stderr:result.stderr,calls:readFileSync(join(dir,"calls"),"utf8").trim().split("\n")};
 };
 it("clears the generated role password before dropping the database",()=>{
  const {calls}=rollback(0);
  expect(calls[0]).toContain('ALTER ROLE "owner" PASSWORD NULL');
  expect(calls[1]).toBe("dropdb bodhi_test");
 });
 it("still clears the password when the database cannot be dropped",()=>{
  const {status,stderr,calls}=rollback(1);
  expect(calls[0]).toContain("PASSWORD NULL");
  expect(calls).toContain("dropdb bodhi_test");
  expect(status).toBe(1);
  expect(stderr).toContain("retained for explicit recovery");
 });
});

describe("systemd user unit ownership",()=>{
 const root=realpathSync(resolve("."));
 const dir=mkdtempSync(join(tmpdir(),"bodhi-unit-"));
 const rendered=()=>{const out=join(dir,`unit-${Math.random().toString(36).slice(2)}.service`);execFileSync("bash",[resolve("scripts/install-systemd-user-service.sh"),"--render-only",out],{env:{PATH:process.env.PATH??"",HOME:dir,BODHI_INSTANCE:"unit-test"}});return readFileSync(out,"utf8");};
 it("recognises the unit it renders for this checkout",()=>{
  const unit=rendered();
  expect(unit).toContain("SyslogIdentifier=com.bodhi.unit-test.server");
  expect(unit).toContain("Restart=on-failure");
  expect(systemdUnitOwned(unit,root)).toBe(true);
 });
 it("refuses a unit for another checkout or with extra commands",()=>{
  const unit=rendered();
  expect(systemdUnitOwned(unit,realpathSync(tmpdir()))).toBe(false);
  expect(systemdUnitOwned(unit.replace("[Service]","[Service]\nExecStartPre=/bin/true"),root)).toBe(false);
  expect(systemdUnitOwned(unit.replace(/ExecStart=.*/,"ExecStart=/bin/sh -c true"),root)).toBe(false);
 });
});

describe("harness installer topologies",()=>{
 const run=(...args:string[])=>spawnSync(process.execPath,[resolve("scripts/install-harness.mjs"),...args],{encoding:"utf8",env:{...process.env,HOME:mkdtempSync(join(tmpdir(),"bodhi-harness-home-"))}});
 it.runIf(process.platform==="darwin")("refuses Linux topologies on macOS",()=>{
  for(const platform of ["wsl","windows-host"]){const result=run("--platform",platform);expect(result.status).toBe(1);expect(result.stderr).toContain("inside the Linux or WSL2 distribution");}
 });
 it("rejects --windows-home without the windows-host topology",()=>{
  const result=run("--windows-home","/tmp");
  expect(result.status).toBe(2);
 });
 it.runIf(process.platform==="linux"&&process.versions.node.startsWith("24."))("renders Windows-side registrations through wsl.exe with copied skills",()=>{
  const windowsHome=mkdtempSync(join(tmpdir(),"bodhi-windows-profile-"));
  const result=spawnSync(process.execPath,[resolve("scripts/install-harness.mjs"),"--platform","windows-host","--windows-home",windowsHome],{encoding:"utf8",env:{...process.env,WSL_DISTRO_NAME:"Ubuntu-24.04"}});
  expect(result.status,result.stderr).toBe(0);
  expect(result.stdout).toContain(`command = "wsl.exe"`);
  expect(result.stdout).toContain(`"-d", "Ubuntu-24.04", "--exec", "/usr/bin/env"`);
  expect(result.stdout).toContain(`claude mcp add bodhi --scope user -- wsl.exe -d Ubuntu-24.04 --exec /usr/bin/env BODHI_ENV_FILE=`);
  expect(result.stdout).toContain(`wsl.exe -d Ubuntu-24.04 --exec /bin/bash ${realpathSync(resolve("."))}/scripts/harness-session-lifecycle.sh codex`);
  expect(result.stdout).toMatch(/would copy session-start/);
  expect(result.stdout).not.toContain('command = "/bin/bash"');
  expect(result.stdout).not.toContain("--env BODHI_ENV_FILE=");
 });
});

// Fixtures are assembled from code points or parts so this shared file never
// contains the literal identity it checks for.
const text=(...codePoints:number[])=>String.fromCodePoint(...codePoints);
const flagged=(value:string)=>ownerNeutralContentError(Buffer.from(value));
const IDENTITY_TERMS=[
 text(83,117,107,104,98,97,116),
 text(83,111,115,111,114,98,97,114,97,109),
 text(84,117,115,104,105,103),
 text(78,121,97,109,107,97),
 text(78,121,97,109,98,97,121,97,114),
 text(68,97,109,100,105,110,100,111,111),
 text(110,121,109,98,97,121,114,48,50,48,54),
 text(65,103,101,110,116,105,99,32,70,111,114,99,101),
 text(97,103,101,110,116,105,99,102,111,114,99,101),
 text(74,101,116,32,66,97,107,101,114,121),
 text(86,73,80,32,67,108,117,98),
 text(78,67,68),
 text(83,104,105,103,116,103,101,101),
 text(90,117,117,115,103,101,108),
 text(65,110,97,114),
 text(65,38,71,45,72,101,114,105,116,97,103,101),
 text(71,97,114,108,105,99),
 text(71,101,114,101,108,115,117,114,101,110),
 text(83,117,117,103,105,105),
 text(65,108,116,97,110,116,117,121,97),
 text(71,101,103,101,101,110,101,101),
 text(85,108,97,97,110,98,97,97,116,97,114),
 text(77,111,115,115,101,116,99,104),
 text(115,117,107,104,98,97,116,45,98,97,114,97,109),
 text(66,97,116,116,117,115,104,105,103),
 text(84,111,103,116,111,107,104),
 text(65,97,103,105,105),
 text(78,121,109,115,117,114,101,110),
 text(69,110,98,111,116,105,99,115),
 text(68,97,121,97,110,115,111,102,116),
 text(72,111,104,104,111,116),
 text(106,101,119,101,108,114,121),
 text(74,101,119,101,108,108,101,114,121),
];
describe("owner-neutral content gate",()=>{
 it.each(IDENTITY_TERMS.map((term,index)=>[index,term] as const))("rejects identity term #%i in any case",(_index,term)=>{
  expect(flagged(`Owner: ${term}.`)).not.toBeNull();
  expect(flagged(term.toUpperCase())).not.toBeNull();
  expect(flagged(term.toLowerCase())).not.toBeNull();
 });
 it("rejects multi-word names with other separators",()=>{
  expect(flagged(text(106,101,116,95,98,97,107,101,114,121))).not.toBeNull();
  expect(flagged(text(118,105,112,45,99,108,117,98))).not.toBeNull();
 });
 it("does not treat ordinary words that contain a short name as identity",()=>{
  for(const word of ["canary release","anarchy","binary tree","garlicky","syncd","ancd"])expect(flagged(word)).toBeNull();
 });
 it("rejects workstation home paths",()=>{
  expect(flagged(["","Users","someone","projects"].join("/"))).not.toBeNull();
  expect(flagged(["","home","someone"].join("/"))).not.toBeNull();
 });
 it("rejects email addresses but not package specifiers",()=>{
  expect(flagged(["owner","example.com"].join("@"))).not.toBeNull();
  expect(flagged(`contact <${["first.last+tag","mail.example.org"].join("@")}>`)).not.toBeNull();
  expect(flagged('"@seneca/core": "*", "vitest@4.1.8", npm install tsx@^4.21.0')).toBeNull();
 });
 it("rejects non-loopback IPv4 literals and allows loopback and unspecified addresses",()=>{
  expect(flagged(`host ${[203,0,113,7].join(".")}`)).not.toBeNull();
  expect(flagged(`listen ${[10,0,0,12].join(".")}:4000`)).not.toBeNull();
  expect(flagged("bind 127.0.0.1, 127.10.0.2 and 0.0.0.0; open http://localhost:4000")).toBeNull();
  expect(flagged("versions 1.2.3, 1.2.3.4.5 and v10.0.0.1")).toBeNull();
 });
 it("exempts only the exact behaviour-bearing identifiers",()=>{
  const zone=text(65,115,105,97,47,85,108,97,97,110,98,97,97,116,97,114);
  const column=`${text(109,111,115,115,101,116,99,104)}_review`;
  expect(flagged(`TIMEZONE=${zone}\n`)).toBeNull();
  expect(flagged(`  ${column} text,`)).toBeNull();
  expect(flagged(`TIMEZONE=${zone}\n${IDENTITY_TERMS[21]} office`)).not.toBeNull();
  expect(flagged(`${column}er`)).not.toBeNull();
  const enumValue=text(106,101,119,101,108,114,121,45,99,104,97,110,103,101,108,111,103);
  expect(flagged(`CREATE TYPE public.briefing_type AS ENUM (\n    '${enumValue}',\n);`)).toBeNull();
  expect(flagged(`"${enumValue}",`)).toBeNull();
  expect(flagged(`${enumValue}-v2`)).not.toBeNull();
  expect(flagged(`push_commit_main_${text(106,101,119,101,108,114,121)}_docs`)).not.toBeNull();
 });
 it("keeps the exact upstream MIT notice allowed and nothing derived from it",()=>{
  const notice=readFileSync(new URL("../LICENSE",import.meta.url));
  expect(ownerNeutralContentError(notice)).toBeNull();
  expect(flagged(`${notice.toString("utf8")}\n`)).not.toBeNull();
 });
 it("never matches its own identity source",()=>{
  for(const path of ["./lib/release-contract.ts","./lib/release-contract.mjs","./distribution.test.ts"])expect(ownerNeutralContentError(readFileSync(new URL(path,import.meta.url)))).toBeNull();
 });
});
