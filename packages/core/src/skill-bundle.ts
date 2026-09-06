import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Hash skill source/resources, not generated interpreter or desktop caches. */
export function skillBundleHash(root: string): string {
  if (!statSync(root).isDirectory()) throw new Error("canonical skill directory is missing");
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "__pycache__" || entry.name === ".DS_Store" || /\.py[co]$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        hash.update(relative(root, path).split(sep).join("/"));
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
      } else {
        throw new Error(`skill bundle contains an unsupported symbolic link or special file: ${relative(root, path)}`);
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}
