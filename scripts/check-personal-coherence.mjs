#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { arch, platform } from "node:os";
import { resolve, sep } from "node:path";
import { validatePersonalReleaseManifest } from "./lib/release-contract.mjs";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] ?? "" : process.cwd());
const json = args.includes("--json");
const findings = [];

function finding(severity, category, message, file) {
  findings.push({ severity, category, message, ...(file ? { file } : {}) });
}

function safePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function readRegular(path, label) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    return { bytes: readFileSync(path), stat };
  } catch (error) {
    finding("fail", "installed-release", `${label} cannot be verified (${String(error)})`, path);
    return null;
  }
}

let manifest;
const manifestPath = resolve(root, ".release/manifest.json");
const manifestFile = readRegular(manifestPath, "release manifest");
if (manifestFile) {
  try {
    manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
  } catch (error) {
    finding("fail", "installed-release", `release manifest is invalid JSON (${String(error)})`, manifestPath);
  }
}

if (manifest) {
  if (validatePersonalReleaseManifest(manifest).length > 0) {
    finding("fail", "installed-release", "release manifest contract or artifact list is invalid", manifestPath);
  } else {
    const currentPlatform = `${platform()}-${arch()}`;
    if (!Array.isArray(manifest.compatibility?.platforms) || !manifest.compatibility.platforms.includes(currentPlatform)) {
      finding("fail", "compatibility", `installed release does not declare ${currentPlatform} compatibility`, manifestPath);
    }

    const rootReal = realpathSync(root);
    const seen = new Set();
    for (const [index, artifact] of manifest.artifacts.entries()) {
      if (!safePath(artifact?.path) || typeof artifact?.sha256 !== "string") {
        finding("fail", "installed-release", `artifact ${index} has an unsafe path or hash`, manifestPath);
        continue;
      }
      if (seen.has(artifact.path)) {
        finding("fail", "installed-release", `artifact path is duplicated: ${artifact.path}`, manifestPath);
        continue;
      }
      seen.add(artifact.path);
      const target = resolve(root, artifact.path);
      if (!target.startsWith(`${root}${sep}`)) {
        finding("fail", "installed-release", `artifact escapes install root: ${artifact.path}`, artifact.path);
        continue;
      }
      const file = readRegular(target, artifact.path);
      if (!file) continue;
      const real = realpathSync(target);
      if (!real.startsWith(`${rootReal}${sep}`)) {
        finding("fail", "installed-release", `artifact resolves outside install root: ${artifact.path}`, artifact.path);
        continue;
      }
      const actual = createHash("sha256").update(file.bytes).digest("hex");
      if (actual !== artifact.sha256) {
        finding("fail", "installed-release", `artifact hash drifted: ${artifact.path}`, artifact.path);
      }
    }
    if (!findings.some((item) => item.severity === "fail")) {
      finding("info", "installed-release", `${seen.size} immutable release artifacts match the manifest`);
    }
  }
}

for (const privateFile of [".env", "AGENTS.md"]) {
  const file = readRegular(resolve(root, privateFile), privateFile);
  if (file && (file.stat.mode & 0o077) !== 0) {
    finding("fail", "private-state", `${privateFile} permissions are broader than 0600`, privateFile);
  }
}

try {
  lstatSync(resolve(root, ".git"));
  finding("fail", "installed-release", "personal release contains a stale Git checkout", ".git");
} catch (error) {
  if (error?.code !== "ENOENT") finding("fail", "installed-release", `cannot inspect .git (${String(error)})`, ".git");
}

const fail = findings.filter((item) => item.severity === "fail").length;
const warn = findings.filter((item) => item.severity === "warn").length;
const info = findings.filter((item) => item.severity === "info").length;
const report = { passed: fail === 0, findings, summary: { fail, warn, info } };

if (json) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  console.log(`personal coherence: ${report.passed ? "PASS" : "FAIL"} (${fail} fail · ${warn} warn · ${info} info)`);
  for (const item of findings) console.log(`- ${item.severity}: ${item.message}`);
}
process.exitCode = report.passed ? 0 : 1;
