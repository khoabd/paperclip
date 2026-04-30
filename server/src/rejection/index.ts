// Barrel re-export for server/src/rejection/.
// No HTTP routes.

export { RejectionStore } from "./rejection-store.js";
export type { RecordRejectionInput, ListByCompanyOpts, RejectionCategory } from "./rejection-store.js";

export { DBSCANClusterer, computeCentroid } from "./dbscan-clusterer.js";
export type { EmbeddingPoint, ClusterResult } from "./dbscan-clusterer.js";

export { AutoActionPolicy } from "./auto-action-policy.js";
export type { AutoAction, ClusterInput } from "./auto-action-policy.js";

export { RejectionClusterer } from "./rejection-clusterer.js";
export type { ClusterRunResult } from "./rejection-clusterer.js";

export { MetaRejectionDetector } from "./meta-rejection-detector.js";
export type { MetaDetectionResult } from "./meta-rejection-detector.js";

export { IntakePromotionBridge } from "./intake-promotion-bridge.js";
export type { PromoteResult } from "./intake-promotion-bridge.js";

export { FeedbackClusterer } from "./feedback-clusterer.js";
export type { FeedbackClusterRunResult } from "./feedback-clusterer.js";
