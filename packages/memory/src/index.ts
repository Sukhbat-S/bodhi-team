export { MemoryService, affectedRows, compositeScore, CONFIDENCE_RANK_WEIGHT, ACCESS_BUMP_DELTA, type MemoryInput, type MemoryResult } from "./service.js";
export { memoryNotSuppressed, memoryVisible } from "./visibility.js";
export { InsightGenerator, type Insight } from "./insights.js";
export { EntityService, type Entity, type EntityType, type EntityWithRelations, type EntityGraphData, isSubjectEntity, SUBJECT_NAMES, configuredSubjectNames } from "./entity-service.js";
export { isCodeSymbol, codeSymbolBucket } from "./code-symbol.js";
export { embed, embedSingle, DIMENSIONS } from "./embedding.js";
export { sanitizeSecrets, sanitizeSecretsDeep } from "./sanitize.js";
export { sanitize, sanitizeMemoryContent } from "./sanitizer.js";
export {
  FoundationImportConflictError,
  FoundationImportValidationError,
  assertFoundationEnvironment,
  foundationPacketHash,
  importReviewedFoundation,
  validateReviewedFoundationPacket,
  type FoundationImportEnvironment,
  type FoundationImportResult,
  type ReviewedFoundationPacket,
} from "./foundation-import.js";
export type { SanitizerKind, SanitizerCategory, SanitizerVerdict, SanitizeOptions } from "./sanitizer.js";
// DriftScanner stays — briefings.ts consumes scan()/formatForBriefing() directly
// (the live Accountability section). ContradictionContextProvider was deleted
// Jul 25, 2026 (Wave 2 prune): 0 contributions across all 602 provider_fire
// events ever, because gather() required looksLikeNewWorkRequest(message),
// which briefing prompts never match.
export { DriftScanner, type DriftFinding, type DriftReport, type EventSink, type AuditSink } from "./drift-scanner.js";
export {
  ENTITY_TAXONOMY,
  SUBTYPE_DESCRIPTIONS,
  type EntityTypeKey,
  type EntitySubtype,
  isValidSubtype,
  renderTaxonomyMenu,
} from "./entity-taxonomy.js";
export { runEval, runScopeAbEval, type EvalReport, type ScopeAbReport, type QueryResult, type FixtureEntry } from "./evals/runner.js";
