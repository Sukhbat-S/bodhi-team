import type { Database as DB } from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export function getStateDbVersion(db: DB): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_version")
    .get() as { v: number | null };
  return row?.v ?? 0;
}

export function runStateMigrations(db: DB): void {
  const files = readdirSync(HERE)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const apply = db.transaction(() => {
    const current = getStateDbVersion(db);
    for (const f of files) {
      const v = Number(basename(f).slice(0, 3));
      if (v <= current) continue;
      const sql = readFileSync(join(HERE, f), "utf8");
      db.exec(sql);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v);
    }
  });
  apply();
}
