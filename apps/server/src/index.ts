import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./create-app.js";
import { startRuntime } from "./lifecycle.js";
import { createRuntime } from "./runtime.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDirectory, "../../../.env") });

async function main() {
  const runtime = await createRuntime();
  const app = createApp(runtime);
  await startRuntime(runtime, app);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
