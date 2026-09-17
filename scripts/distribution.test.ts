import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {classifyReleasePath,ownerNeutralContentError,validatePersonalReleaseManifest} from "./lib/release-contract.js";
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
  "templates/personal/skills/skill-evolution/SKILL.md",
  "templates/personal/skills/operational-debugging/SKILL.md",
  "skill-evals/evals/results/latest.json",
  "skill-evals/evals/fire-other-skill/prompt.md",
  "skill-evals/skills/research-chain",
  ".claude/skills/session-start",
  "CLAUDE.md",
 ])("keeps retired, generated or owner-local path %s outside the release",path=>expect(classifyReleasePath(path)).not.toBe("shared"));
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
