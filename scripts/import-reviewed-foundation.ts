import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { closeDb, getDb } from "../packages/db/src/client.js";
import { embed } from "../packages/memory/src/embedding.js";
import { importReviewedFoundation } from "../packages/memory/src/foundation-import.js";

const packetArgument = process.argv[2];
if (!packetArgument || process.argv.length !== 3) {
  console.error("usage: npx tsx scripts/import-reviewed-foundation.ts <private-packet.json>");
  process.exit(2);
}

async function main(): Promise<void> {
  const packetPath = resolve(packetArgument);
  const mode = statSync(packetPath).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error("private packet permissions must be 0600 or stricter");

  const ownerName = process.env.BODHI_OWNER_NAME?.trim();
  const assistantName = process.env.BODHI_ASSISTANT_NAME?.trim();
  const voyageApiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!ownerName) throw new Error("BODHI_OWNER_NAME is required");
  if (!assistantName) throw new Error("BODHI_ASSISTANT_NAME is required");
  if (!voyageApiKey) throw new Error("VOYAGE_API_KEY is required");

  const packet = JSON.parse(readFileSync(packetPath, "utf8")) as unknown;
  const result = await importReviewedFoundation(
    getDb(),
    packet,
    {
      ownerName,
      assistantName,
      ownerAliases: (process.env.BODHI_OWNER_ALIASES ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    },
    (texts) => embed(texts, voyageApiKey),
  );
  console.log(JSON.stringify({
    ok: true,
    packetId: result.packetId,
    contentHash: result.contentHash,
    applied: result.applied,
    counts: result.counts,
  }, null, 2));
}

main().then(() => closeDb()).catch(async (error) => {
  console.error(`foundation import failed: ${error instanceof Error ? error.message : String(error)}`);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
