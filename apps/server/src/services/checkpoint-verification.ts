import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";

export type EffectiveVerificationState = "passed" | "failed" | "pending" | "contradicted" | "not-required" | "unavailable";
export interface LineageReceipt {
  id: string;
  status: "pending" | "passed" | "failed";
  subjectRevision: string | null;
  supersedesReceiptId: string | null;
}
export interface EffectiveVerification { state: EffectiveVerificationState; receiptIds: string[] }
export interface CompletionEvidence {
  completionVerificationState: string | null;
  completionReceiptIds: string[] | null;
}

/** Explicit predecessor links alone establish correlation. Text/time never does. */
export function receiptRoot(receiptId: string, receipts: readonly LineageReceipt[]): string | null {
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  if (byId.size !== receipts.length) return null;
  const seen = new Set<string>();
  let current = byId.get(receiptId);
  const revision = current?.subjectRevision;
  if (!revision || !/^[a-f0-9]{64}$/.test(revision)) return null;
  while (current) {
    if (seen.has(current.id) || current.subjectRevision !== revision) return null;
    seen.add(current.id);
    if (current.supersedesReceiptId === null) return current.id;
    current = byId.get(current.supersedesReceiptId);
  }
  return null;
}

export function deriveEffectiveVerification(completion: CompletionEvidence, receipts: readonly LineageReceipt[]): EffectiveVerification {
  const unavailable: EffectiveVerification = { state: "unavailable", receiptIds: [] };
  const manifest = completion.completionReceiptIds;
  if (!manifest || new Set(manifest).size !== manifest.length) return unavailable;
  if (manifest.length === 0) return completion.completionVerificationState === "not-required"
    ? { state: "not-required", receiptIds: [] } : unavailable;
  if (!["passed", "failed"].includes(completion.completionVerificationState ?? "")) return unavailable;
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  if (byId.size !== receipts.length) return unavailable;
  const roots = new Set<string>(), heads: LineageReceipt[] = [];
  for (const id of manifest) {
    const root = receiptRoot(id, receipts);
    if (!root || roots.has(root)) return unavailable;
    roots.add(root);
    let head = byId.get(id)!;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(head.id)) return unavailable;
      seen.add(head.id);
      const children = receipts.filter((receipt) => receipt.supersedesReceiptId === head.id);
      if (children.length > 1) return unavailable;
      if (!children.length) break;
      if (children[0].subjectRevision !== head.subjectRevision || receiptRoot(children[0].id, receipts) !== root) return unavailable;
      head = children[0];
    }
    heads.push(head);
  }
  const receiptIds = heads.map((head) => head.id);
  if (heads.some((head) => head.status === "failed")) return {
    state: completion.completionVerificationState === "passed" ? "contradicted" : "failed", receiptIds,
  };
  if (heads.some((head) => head.status === "pending")) return { state: "pending", receiptIds };
  return heads.every((head) => head.status === "passed") ? { state: "passed", receiptIds } : unavailable;
}

/** Caller transaction owns the checkpoint lock for any success-dependent write. */
export async function readEffectiveCompletion(executor: Pick<Database, "execute">, id: string, lock = false) {
  const rows = await executor.execute(sql`
    SELECT id, project_key AS "projectKey", state,
      completion_verification_state AS "completionVerificationState", completion_receipt_ids AS "completionReceiptIds"
    FROM work_checkpoints WHERE id = ${id}::uuid ${lock ? sql`FOR UPDATE` : sql``}
  `) as unknown as Array<CompletionEvidence & { id: string; projectKey: string; state: string }>;
  if (!rows[0]) return null;
  const receipts = await executor.execute(sql`
    SELECT id, status, subject_revision AS "subjectRevision", supersedes_receipt_id AS "supersedesReceiptId"
    FROM verification_receipts WHERE checkpoint_id = ${id}::uuid
  `) as unknown as LineageReceipt[];
  return { ...rows[0], effectiveVerification: deriveEffectiveVerification(rows[0], receipts), receipts };
}

export function isEffectivelyPassed(completion: Awaited<ReturnType<typeof readEffectiveCompletion>>): boolean {
  return completion?.state === "completed" && completion.completionVerificationState === "passed"
    && completion.effectiveVerification.state === "passed";
}
