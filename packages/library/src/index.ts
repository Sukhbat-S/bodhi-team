// ============================================================
// @seneca/library — public exports.
//
// Wave 1 LP (May 19, 2026): the library service moves out of the
// inline /api/library/search handler so both the HTTP endpoint and
// LibraryProvider share one search path (and one telemetry write).
//
// Wave 1a (Jul 25, 2026): LibraryProvider and library-intent were deleted.
// Library went PULL-only on Jun 22 — the PUSH provider was structurally inert
// from that day, and its intent gate (computeLibraryIntent) existed only to
// decide whether that PUSH should fire. Retrieval now runs through the MCP
// librarian. LibraryService and cite-detector remain
// live: service.ts backs /api/library/search, cite-detector backs
// scheduler/jobs/briefings.ts.
// ============================================================

export { LibraryService } from "./service.js";
export type {
  LibraryHit,
  LibrarySearchArgs,
  LibraryIndexEntry,
  LibraryIndexResult,
} from "./service.js";
export { detectCitations, summarizeCitations } from "./cite-detector.js";
export type { LibraryCitation } from "./cite-detector.js";
export { slidingWindowSpans, CHUNK_SIZE, CHUNK_OVERLAP } from "./chunker.js";
export type { WindowSpan } from "./chunker.js";
export {
  assertCorpusEnvironment,
  corpusManifestHash,
  CorpusImportConflictError,
  CorpusImportValidationError,
  importReviewedCorpus,
  materializeCorpusChunks,
  validateReviewedCorpusManifest,
} from "./corpus-import.js";
export type {
  CorpusChunk,
  CorpusFileReference,
  CorpusImportEnvironment,
  CorpusImportResult,
  LoadedCorpusFile,
  ReviewedCorpusManifest,
} from "./corpus-import.js";
// Wave F (Jun 10, 2026): library retrieval eval — the corpus's first recall signal.
export { runLibraryEval } from "./evals/runner.js";
export type {
  LibraryEvalReport,
  LibraryQueryResult,
  LibraryFixtureEntry,
} from "./evals/runner.js";
