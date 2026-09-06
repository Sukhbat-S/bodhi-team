import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@seneca/db";
import { CHUNK_SIZE, slidingWindowSpans } from "./chunker.js";

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FILE_KINDS = new Set(["conversation-chains", "reviewed-evidence", "analysis"] as const);
const VOYAGE_BATCH = 96;

export class CorpusImportValidationError extends Error {}
export class CorpusImportConflictError extends Error {}

export interface CorpusFileReference {
  key: string;
  kind: "conversation-chains" | "reviewed-evidence" | "analysis";
  path: string;
  sha256: string;
  recordCount: number;
}

export interface ReviewedCorpusManifest {
  schemaVersion: 1;
  packetId: string;
  owner: { name: string; aliases: string[] };
  assistant: { name: string };
  review: { reviewedBy: string; reviewedAt: string; approvedCompletePrivateImport: true };
  source: {
    kind: string;
    reference: string;
    capturedAt: string;
    dateStart: string;
    dateEnd: string;
  };
  files: CorpusFileReference[];
}

export interface CorpusImportEnvironment {
  ownerName: string;
  ownerAliases: string[];
  assistantName: string;
}

export interface LoadedCorpusFile {
  reference: CorpusFileReference;
  records: unknown[];
}

export interface CorpusChunk {
  source: string;
  domain: "personal-history";
  subDomain: "chatgpt-conversations" | "reviewed-evidence" | "corpus-analysis";
  chunkIndex: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface CorpusImportResult {
  packetId: string;
  contentHash: string;
  applied: boolean;
  counts: {
    files: number;
    conversations: number;
    reviewedEvidence: number;
    analyses: number;
    chunks: number;
  };
}

type Embedder = (texts: string[]) => Promise<number[][]>;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CorpusImportValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new CorpusImportValidationError(`${field}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!(key in value)) throw new CorpusImportValidationError(`${field}.${key} is required`);
  }
}

function text(value: unknown, field: string, max = 20_000): string {
  if (typeof value !== "string" || !value.trim()) throw new CorpusImportValidationError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new CorpusImportValidationError(`${field} exceeds ${max} characters`);
  return normalized;
}

function key(value: unknown, field: string): string {
  const normalized = text(value, field, 120);
  if (!KEY_RE.test(normalized)) throw new CorpusImportValidationError(`${field} is invalid`);
  return normalized;
}

function stringArray(value: unknown, field: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new CorpusImportValidationError(`${field} must be an array of at most ${maxItems} items`);
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, 500));
  if (new Set(result.map((item) => item.toLocaleLowerCase())).size !== result.length) {
    throw new CorpusImportValidationError(`${field} contains duplicates`);
  }
  return result;
}

function isoDate(value: unknown, field: string): string {
  const normalized = text(value, field, 100);
  if (Number.isNaN(Date.parse(normalized))) throw new CorpusImportValidationError(`${field} must be an ISO date`);
  return new Date(normalized).toISOString();
}

function relativePrivatePath(value: unknown, field: string): string {
  const normalized = text(value, field, 500);
  if (
    normalized.startsWith("/")
    || normalized.includes("\\")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new CorpusImportValidationError(`${field} must be a safe relative path`);
  }
  return normalized;
}

export function validateReviewedCorpusManifest(value: unknown): ReviewedCorpusManifest {
  const root = record(value, "manifest");
  exactKeys(root, ["schemaVersion", "packetId", "owner", "assistant", "review", "source", "files"], ["schemaVersion", "packetId", "owner", "assistant", "review", "source", "files"], "manifest");
  if (root.schemaVersion !== 1) throw new CorpusImportValidationError("manifest.schemaVersion must be 1");

  const owner = record(root.owner, "manifest.owner");
  exactKeys(owner, ["name", "aliases"], ["name", "aliases"], "manifest.owner");
  const assistant = record(root.assistant, "manifest.assistant");
  exactKeys(assistant, ["name"], ["name"], "manifest.assistant");
  const review = record(root.review, "manifest.review");
  exactKeys(review, ["reviewedBy", "reviewedAt", "approvedCompletePrivateImport"], ["reviewedBy", "reviewedAt", "approvedCompletePrivateImport"], "manifest.review");
  if (review.approvedCompletePrivateImport !== true) {
    throw new CorpusImportValidationError("manifest.review.approvedCompletePrivateImport must be true");
  }
  const source = record(root.source, "manifest.source");
  exactKeys(source, ["kind", "reference", "capturedAt", "dateStart", "dateEnd"], ["kind", "reference", "capturedAt", "dateStart", "dateEnd"], "manifest.source");

  if (!Array.isArray(root.files) || root.files.length < 1 || root.files.length > 20) {
    throw new CorpusImportValidationError("manifest.files must contain 1 to 20 files");
  }
  const files = root.files.map((raw, index): CorpusFileReference => {
    const item = record(raw, `manifest.files[${index}]`);
    exactKeys(item, ["key", "kind", "path", "sha256", "recordCount"], ["key", "kind", "path", "sha256", "recordCount"], `manifest.files[${index}]`);
    if (!FILE_KINDS.has(item.kind as CorpusFileReference["kind"])) {
      throw new CorpusImportValidationError(`manifest.files[${index}].kind is invalid`);
    }
    if (typeof item.sha256 !== "string" || !SHA256_RE.test(item.sha256)) {
      throw new CorpusImportValidationError(`manifest.files[${index}].sha256 must be lowercase SHA-256`);
    }
    if (!Number.isInteger(item.recordCount) || Number(item.recordCount) < 1 || Number(item.recordCount) > 10_000) {
      throw new CorpusImportValidationError(`manifest.files[${index}].recordCount is invalid`);
    }
    return {
      key: key(item.key, `manifest.files[${index}].key`),
      kind: item.kind as CorpusFileReference["kind"],
      path: relativePrivatePath(item.path, `manifest.files[${index}].path`),
      sha256: item.sha256,
      recordCount: Number(item.recordCount),
    };
  });
  if (new Set(files.map((item) => item.key)).size !== files.length) throw new CorpusImportValidationError("manifest.files contains duplicate keys");
  if (new Set(files.map((item) => item.path)).size !== files.length) throw new CorpusImportValidationError("manifest.files contains duplicate paths");
  if (files.filter((item) => item.kind === "conversation-chains").length !== 1) {
    throw new CorpusImportValidationError("manifest.files must contain exactly one conversation-chains file");
  }

  const manifest: ReviewedCorpusManifest = {
    schemaVersion: 1,
    packetId: key(root.packetId, "manifest.packetId"),
    owner: { name: text(owner.name, "manifest.owner.name", 500), aliases: stringArray(owner.aliases, "manifest.owner.aliases") },
    assistant: { name: text(assistant.name, "manifest.assistant.name", 500) },
    review: {
      reviewedBy: text(review.reviewedBy, "manifest.review.reviewedBy", 500),
      reviewedAt: isoDate(review.reviewedAt, "manifest.review.reviewedAt"),
      approvedCompletePrivateImport: true,
    },
    source: {
      kind: text(source.kind, "manifest.source.kind", 200),
      reference: text(source.reference, "manifest.source.reference", 2_000),
      capturedAt: isoDate(source.capturedAt, "manifest.source.capturedAt"),
      dateStart: isoDate(source.dateStart, "manifest.source.dateStart"),
      dateEnd: isoDate(source.dateEnd, "manifest.source.dateEnd"),
    },
    files,
  };
  if (manifest.source.dateStart > manifest.source.dateEnd) {
    throw new CorpusImportValidationError("manifest.source date range is reversed");
  }
  return manifest;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(item).sort().map((name) => [name, stable(item[name])]));
  }
  return value;
}

export function corpusManifestHash(manifest: ReviewedCorpusManifest): string {
  return createHash("sha256").update(JSON.stringify(stable(manifest))).digest("hex");
}

export function assertCorpusEnvironment(manifest: ReviewedCorpusManifest, environment: CorpusImportEnvironment): void {
  if (manifest.owner.name !== environment.ownerName.trim()) {
    throw new CorpusImportValidationError(`manifest owner ${manifest.owner.name} does not match installation owner ${environment.ownerName.trim()}`);
  }
  if (manifest.assistant.name !== environment.assistantName.trim()) {
    throw new CorpusImportValidationError(`manifest assistant ${manifest.assistant.name} does not match installation assistant ${environment.assistantName.trim()}`);
  }
  const aliases = new Set(environment.ownerAliases.map((item) => item.trim().toLocaleLowerCase()));
  for (const alias of manifest.owner.aliases) {
    if (!aliases.has(alias.toLocaleLowerCase())) {
      throw new CorpusImportValidationError(`manifest owner alias ${alias} is not configured on this installation`);
    }
  }
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function renderConversation(value: unknown, index: number): { id: string; text: string; metadata: Record<string, unknown> } {
  const item = record(value, `conversations[${index}]`);
  const id = scalarText(item.record_id);
  if (!id) throw new CorpusImportValidationError(`conversations[${index}].record_id is required`);
  if (!Array.isArray(item.evidence_chain)) throw new CorpusImportValidationError(`conversations[${index}].evidence_chain must be an array`);
  const title = scalarText(item.title) ?? "Untitled conversation";
  const turns = item.evidence_chain.map((raw, turnIndex) => {
    const turn = record(raw, `conversations[${index}].evidence_chain[${turnIndex}]`);
    const speaker = scalarText(turn.speaker) ?? "unknown";
    const body = typeof turn.text === "string" ? turn.text.trim() : "";
    const timestamp = scalarText(turn.timestamp);
    return `${speaker}${timestamp ? ` (${timestamp})` : ""}: ${body || "[empty turn]"}`;
  });
  return {
    id,
    text: [`Title: ${title}`, `Date: ${scalarText(item.date_start) ?? "unknown"} — ${scalarText(item.date_end) ?? "unknown"}`, `Conversation ID: ${id}`, "", ...turns].join("\n"),
    metadata: {
      record_id: id,
      title,
      date_start: scalarText(item.date_start),
      date_end: scalarText(item.date_end),
      chain_completeness: item.chain_completeness ?? null,
      turn_count: item.evidence_chain.length,
    },
  };
}

function renderReviewedEvidence(value: unknown, index: number): { id: string; text: string; metadata: Record<string, unknown> } {
  const item = record(value, `reviewedEvidence[${index}]`);
  const id = scalarText(item.record_id);
  if (!id) throw new CorpusImportValidationError(`reviewedEvidence[${index}].record_id is required`);
  const textValue = JSON.stringify(item, null, 2);
  return {
    id,
    text: `Reviewed evidence for conversation ${id}\n${textValue}`,
    metadata: {
      record_id: id,
      review_source: item.review_source ?? null,
      relevance: item.relevance ?? null,
      confidence: item.confidence ?? null,
      final_labels: item.final_labels ?? null,
      status_signals: item.status_signals ?? null,
    },
  };
}

function normalizeWellFormedString(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value[index]! + value[index + 1]!;
        index += 1;
      } else {
        normalized += "�";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      normalized += "�";
    } else {
      normalized += value[index]!;
    }
  }
  return normalized;
}

function chunksForText(textValue: string): Array<{ text: string; charStart: number; charEnd: number }> {
  if (textValue.length <= CHUNK_SIZE) return [{ text: normalizeWellFormedString(textValue), charStart: 0, charEnd: textValue.length }];
  return slidingWindowSpans(textValue, 0, textValue.length).map((span) => ({
    text: normalizeWellFormedString(textValue.slice(span.start, span.end).trim()),
    charStart: span.start,
    charEnd: span.end,
  })).filter((chunk) => chunk.text.length > 0);
}

function normalizeUnicode(value: unknown): unknown {
  if (typeof value === "string") return normalizeWellFormedString(value);
  if (Array.isArray(value)) return value.map(normalizeUnicode);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(item).map(([name, child]) => [normalizeWellFormedString(name), normalizeUnicode(child)]));
  }
  return value;
}

export function materializeCorpusChunks(manifest: ReviewedCorpusManifest, files: LoadedCorpusFile[]): CorpusChunk[] {
  const expected = new Map(manifest.files.map((item) => [item.key, item]));
  if (files.length !== expected.size) throw new CorpusImportValidationError("loaded file count does not match manifest");
  const chunks: CorpusChunk[] = [];
  const sourceIds = new Set<string>();

  for (const file of files) {
    const reference = expected.get(file.reference.key);
    if (!reference || JSON.stringify(reference) !== JSON.stringify(file.reference)) {
      throw new CorpusImportValidationError(`loaded file ${file.reference.key} does not match manifest`);
    }
    if (file.records.length !== reference.recordCount) {
      throw new CorpusImportValidationError(`${reference.key} record count ${file.records.length} does not match manifest ${reference.recordCount}`);
    }

    file.records.forEach((raw, index) => {
      let rendered: { id: string; text: string; metadata: Record<string, unknown> };
      let subDomain: CorpusChunk["subDomain"];
      if (reference.kind === "conversation-chains") {
        rendered = renderConversation(raw, index);
        subDomain = "chatgpt-conversations";
      } else if (reference.kind === "reviewed-evidence") {
        rendered = renderReviewedEvidence(raw, index);
        subDomain = "reviewed-evidence";
      } else {
        rendered = {
          id: file.records.length === 1 ? reference.key : `${reference.key}-${index + 1}`,
          text: `${reference.key}\n${JSON.stringify(raw, null, 2)}`,
          metadata: { analysis_key: reference.key, record_index: index },
        };
        subDomain = "corpus-analysis";
      }
      const source = normalizeWellFormedString(`private/chatgpt/${manifest.packetId}/${reference.kind}/${rendered.id}`);
      if (sourceIds.has(source)) throw new CorpusImportValidationError(`duplicate source identity ${source}`);
      sourceIds.add(source);
      for (const [chunkIndex, chunk] of chunksForText(rendered.text).entries()) {
        chunks.push({
          source,
          domain: "personal-history",
          subDomain,
          chunkIndex,
          text: chunk.text,
          metadata: normalizeUnicode({
            ...rendered.metadata,
            packet_id: manifest.packetId,
            corpus_file: reference.key,
            source_kind: reference.kind,
            char_start: chunk.charStart,
            char_end: chunk.charEnd,
            private: true,
          }) as Record<string, unknown>,
        });
      }
    });
  }
  return chunks;
}

function validateEmbeddings(embeddings: number[][], expected: number): void {
  if (
    embeddings.length !== expected
    || embeddings.some((item) => !Array.isArray(item) || item.length !== 1024 || item.some((value) => !Number.isFinite(value)))
  ) {
    throw new CorpusImportValidationError("embedder must return one finite 1024-dimension vector per chunk");
  }
}

function importCounts(manifest: ReviewedCorpusManifest, chunks: CorpusChunk[]): CorpusImportResult["counts"] {
  return {
    files: manifest.files.length,
    conversations: manifest.files.filter((item) => item.kind === "conversation-chains").reduce((sum, item) => sum + item.recordCount, 0),
    reviewedEvidence: manifest.files.filter((item) => item.kind === "reviewed-evidence").reduce((sum, item) => sum + item.recordCount, 0),
    analyses: manifest.files.filter((item) => item.kind === "analysis").reduce((sum, item) => sum + item.recordCount, 0),
    chunks: chunks.length,
  };
}

export async function importReviewedCorpus(
  db: Database,
  manifestInput: unknown,
  files: LoadedCorpusFile[],
  environment: CorpusImportEnvironment,
  embedder: Embedder,
): Promise<CorpusImportResult> {
  const manifest = validateReviewedCorpusManifest(manifestInput);
  assertCorpusEnvironment(manifest, environment);
  const contentHash = corpusManifestHash(manifest);

  const prior = await db.execute(sql`
    SELECT content_hash AS "contentHash", imported_counts AS counts
    FROM corpus_imports WHERE packet_id = ${manifest.packetId} LIMIT 1
  `) as unknown as Array<{ contentHash: string; counts: CorpusImportResult["counts"] }>;
  if (prior[0]) {
    if (prior[0].contentHash !== contentHash) throw new CorpusImportConflictError(`packet ${manifest.packetId} already exists with a different content hash`);
    return { packetId: manifest.packetId, contentHash, applied: false, counts: prior[0].counts };
  }

  const chunks = materializeCorpusChunks(manifest, files);
  const embeddings: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += VOYAGE_BATCH) {
    const batch = chunks.slice(offset, offset + VOYAGE_BATCH);
    const batchEmbeddings = await embedder(batch.map((item) => item.text));
    validateEmbeddings(batchEmbeddings, batch.length);
    embeddings.push(...batchEmbeddings);
  }
  const counts = importCounts(manifest, chunks);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${manifest.packetId}))`);
    const lockedPrior = await tx.execute(sql`
      SELECT content_hash AS "contentHash", imported_counts AS counts
      FROM corpus_imports WHERE packet_id = ${manifest.packetId} LIMIT 1
    `) as unknown as Array<{ contentHash: string; counts: CorpusImportResult["counts"] }>;
    if (lockedPrior[0]) {
      if (lockedPrior[0].contentHash !== contentHash) throw new CorpusImportConflictError(`packet ${manifest.packetId} already exists with a different content hash`);
      return { packetId: manifest.packetId, contentHash, applied: false, counts: lockedPrior[0].counts };
    }

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      await tx.execute(sql`
        INSERT INTO library_entries (source, domain, sub_domain, chunk_index, chunk_text, embedding, metadata)
        VALUES (
          ${chunk.source}, ${chunk.domain}, ${chunk.subDomain}, ${chunk.chunkIndex}, ${chunk.text},
          ${JSON.stringify(embeddings[index])}::vector, ${JSON.stringify(chunk.metadata)}::jsonb
        )
      `);
    }
    await tx.execute(sql`
      INSERT INTO corpus_imports (
        packet_id, owner_name, assistant_name, content_hash, reviewed_by, reviewed_at,
        source_metadata, file_manifest, imported_counts
      ) VALUES (
        ${manifest.packetId}, ${manifest.owner.name}, ${manifest.assistant.name}, ${contentHash},
        ${manifest.review.reviewedBy}, ${manifest.review.reviewedAt},
        ${JSON.stringify(manifest.source)}::jsonb, ${JSON.stringify(manifest.files)}::jsonb,
        ${JSON.stringify(counts)}::jsonb
      )
    `);
    return { packetId: manifest.packetId, contentHash, applied: true, counts };
  });
}
