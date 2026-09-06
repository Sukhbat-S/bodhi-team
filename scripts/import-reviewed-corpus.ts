import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { closeDb, getDb } from "../packages/db/src/client.js";
import { embed } from "../packages/memory/src/embedding.js";
import {
  importReviewedCorpus,
  validateReviewedCorpusManifest,
  type LoadedCorpusFile,
} from "../packages/library/src/corpus-import.js";

const manifestArgument = process.argv[2];
if (!manifestArgument || process.argv.length !== 3) {
  console.error("usage: npx tsx scripts/import-reviewed-corpus.ts <private-bundle/manifest.json>");
  process.exit(2);
}

function assertPrivateMode(path: string, kind: "file" | "directory"): void {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`private ${kind} ${path} permissions must deny group/other access`);
}

function parseJsonLines(raw: string, field: string): unknown[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`${field} line ${index + 1} is invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  });
}

async function main(): Promise<void> {
  const manifestPath = realpathSync(resolve(manifestArgument));
  const bundleRoot = realpathSync(dirname(manifestPath));
  assertPrivateMode(bundleRoot, "directory");
  assertPrivateMode(manifestPath, "file");
  const manifest = validateReviewedCorpusManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);

  const files: LoadedCorpusFile[] = manifest.files.map((reference) => {
    const candidate = resolve(bundleRoot, reference.path);
    const filePath = realpathSync(candidate);
    if (!(filePath === bundleRoot || filePath.startsWith(`${bundleRoot}${sep}`))) throw new Error(`${reference.key} resolves outside private bundle`);
    assertPrivateMode(filePath, "file");
    const raw = readFileSync(filePath, "utf8");
    const actualHash = createHash("sha256").update(raw).digest("hex");
    if (actualHash !== reference.sha256) throw new Error(`${reference.key} SHA-256 mismatch`);
    const records = reference.kind === "analysis"
      ? [JSON.parse(raw) as unknown]
      : parseJsonLines(raw, reference.key);
    return { reference, records };
  });

  const ownerName = process.env.BODHI_OWNER_NAME?.trim();
  const assistantName = process.env.BODHI_ASSISTANT_NAME?.trim();
  const voyageApiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!ownerName) throw new Error("BODHI_OWNER_NAME is required");
  if (!assistantName) throw new Error("BODHI_ASSISTANT_NAME is required");
  if (!voyageApiKey) throw new Error("VOYAGE_API_KEY is required");

  const result = await importReviewedCorpus(
    getDb(),
    manifest,
    files,
    {
      ownerName,
      assistantName,
      ownerAliases: (process.env.BODHI_OWNER_ALIASES ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    },
    (texts) => embed(texts, voyageApiKey),
  );
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().then(() => closeDb()).catch(async (error) => {
  console.error(`corpus import failed: ${error instanceof Error ? error.message : String(error)}`);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
