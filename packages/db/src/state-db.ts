import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveBodhiPath } from "@seneca/core";

let cached: DB | null = null;
let cachedPath: string | null = null;

export function openStateDb(): DB {
  const path = resolveBodhiPath("state.db");
  if (cached && cachedPath === path) return cached;
  if (cached) {
    cached.close();
    cached = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 1000");
  cached = db;
  cachedPath = path;
  return db;
}

export function _closeStateDb(): void {
  if (cached) {
    cached.close();
    cached = null;
    cachedPath = null;
  }
}

export interface RetryOpts {
  maxRetries?: number;
  baseDelayMs?: number;
}

function isBusyError(e: any): boolean {
  if (!e) return false;
  if (e.code === "SQLITE_BUSY") return true;
  return /database is locked/i.test(String(e.message ?? ""));
}

export async function withWriteRetry<T>(
  fn: () => T | Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const max = opts.maxRetries ?? 15;
  const base = opts.baseDelayMs ?? 20;
  let lastErr: unknown;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isBusyError(e)) throw e;
      const jitter = Math.random() * 130;
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
  throw lastErr;
}
