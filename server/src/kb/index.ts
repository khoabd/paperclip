// KB service barrel — no HTTP routes, per Phase 11 spec.
export { MagikaInventoryService, MockMagikaClient } from "./magika-inventory.js";
export type { FileInput, MagikaResult, MagikaClient } from "./magika-inventory.js";
export { TreeSitterChunker } from "./tree-sitter-chunker.js";
export type { SymbolChunk } from "./tree-sitter-chunker.js";
export { KBDocumentStore } from "./kb-document-store.js";
export type { CreateDocInput } from "./kb-document-store.js";
export { KBColdStartBootstrap } from "./kb-cold-start-bootstrap.js";
export type { BootstrapSummary } from "./kb-cold-start-bootstrap.js";
export { KBCoverageAuditor } from "./kb-coverage-auditor.js";
export { KBStalenessScorer } from "./kb-staleness-scorer.js";
export type { StalenessResult } from "./kb-staleness-scorer.js";
export { PRGateKBUpdater } from "./pr-gate-kb-updater.js";
export type { ChangedFile, PRGateResult } from "./pr-gate-kb-updater.js";
export { L2TimelineEstimator } from "./l2-timeline-estimator.js";
export type { L2Estimate } from "./l2-timeline-estimator.js";
