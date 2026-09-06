// ============================================================
// BODHI — audit.write helper (Phase 33 C1, May 25, 2026)
//
// Append-only audit trail. Hash-not-body discipline: stores SHA-256
// of the payload + byte length + non-sensitive metadata. Never the
// payload bytes themselves.
//
// Best-effort: every failure path is logged + swallowed so an audit-
// write failure NEVER breaks the caller's side-effecting action.
// ============================================================

import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import { createHash, randomUUID } from "node:crypto";

export interface AuditWriteParams {
  kind: string;
  actor: string;
  target?: string | null;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditService {
  write: (params: AuditWriteParams) => Promise<void>;
  query: (opts: { kind?: string; actor?: string; days?: number; limit?: number }) => Promise<Array<Record<string, unknown>>>;
}

export function createAuditService(db: Database): AuditService {
  async function write(params: AuditWriteParams): Promise<void> {
    try {
      let payloadHash: string | null = null;
      let payloadLength: number | null = null;
      if (params.payload !== undefined && params.payload !== null) {
        const text = typeof params.payload === "string"
          ? params.payload
          : JSON.stringify(params.payload);
        payloadHash = createHash("sha256").update(text).digest("hex");
        payloadLength = Buffer.byteLength(text, "utf8");
      }

      const id = randomUUID();
      const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

      await db.execute(sql`
        INSERT INTO system_audit (id, kind, actor, target, payload_hash, payload_length, metadata)
        VALUES (${id}, ${params.kind}, ${params.actor}, ${params.target ?? null}, ${payloadHash}, ${payloadLength}, ${metadata ? sql`${metadata}::jsonb` : null})
      `);
    } catch (err) {
      console.error("[audit] write failed:", err instanceof Error ? err.message : err);
    }
  }

  async function query(opts: { kind?: string; actor?: string; days?: number; limit?: number }) {
    const days = Math.max(1, Math.min(90, opts.days ?? 7));
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const conditions: ReturnType<typeof sql>[] = [
      sql`ts > now() - (${days} || ' days')::interval`,
    ];
    if (opts.kind) conditions.push(sql`kind = ${opts.kind}`);
    if (opts.actor) conditions.push(sql`actor = ${opts.actor}`);

    const whereClause = conditions.reduce<ReturnType<typeof sql>>((acc, cond, idx) =>
      idx === 0 ? cond : sql`${acc} AND ${cond}`,
      sql``,
    );

    const rows = await db.execute(sql`
      SELECT id, kind, actor, target, payload_hash AS "payloadHash",
             payload_length AS "payloadLength", metadata, ts
      FROM system_audit
      WHERE ${whereClause}
      ORDER BY ts DESC
      LIMIT ${limit}
    `);
    return rows as unknown as Array<Record<string, unknown>>;
  }

  return { write, query };
}
