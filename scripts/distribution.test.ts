import {describe,it,expect} from "vitest";
import {classifyReleasePath,ownerNeutralContentError,validatePersonalReleaseManifest} from "./lib/release-contract.js";
describe("distribution boundary",()=>{
 it.each([".env","data/records.json","backups/snapshot.sql","profiles/owner.json","../outside.json","auth.json"])("excludes private path %s",path=>expect(classifyReleasePath(path)).not.toBe("shared"));
 it("includes reviewed code and generic skills",()=>{expect(classifyReleasePath("apps/server/src/config.ts")).toBe("shared");expect(classifyReleasePath("templates/personal/skills/component-driven-ui/SKILL.md")).toBe("shared")});
 it("does not admit arbitrary reports",()=>expect(classifyReleasePath("reports/notes.md")).not.toBe("shared"));
});
