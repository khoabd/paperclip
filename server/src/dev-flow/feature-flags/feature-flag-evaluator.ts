// FeatureFlagEvaluator: context-aware flag evaluation with workspace override support.
// Sources: override > status_on > status_off > rollout (canary).
// Per Phase-7-Development-Flow-Feature-Flags §7.2.

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { featureFlags, featureFlagWorkspaceOverrides } from "@paperclipai/db";
import { hashWorkspaceToBucket } from "../../platform/skill-library.js";

export type EvalSource =
  | "override"
  | "status_on"
  | "status_off"
  | "rollout"
  | "unknown";

export interface EvalInput {
  companyId: string;
  flagKey: string;
  /** Optional user id — used as hash input when present; falls back to companyId. */
  userId?: string | null;
}

export interface EvalResult {
  enabled: boolean;
  source: EvalSource;
}

/**
 * Evaluate a feature flag for a given workspace + optional user.
 *
 * Logic:
 *   1. status='off'    → disabled regardless of everything else.
 *   2. workspace override row → forced value (override).
 *   3. status='on'     → always enabled.
 *   4. status='canary' → FNV-1a hash bucket vs rollout_percent.
 */
export class FeatureFlagEvaluator {
  constructor(private readonly db: Db) {}

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const [flag] = await this.db
      .select()
      .from(featureFlags)
      .where(
        and(eq(featureFlags.companyId, input.companyId), eq(featureFlags.key, input.flagKey)),
      )
      .limit(1);

    if (!flag) return { enabled: false, source: "unknown" };

    // Rule 1: status=off overrides everything — check before override so we
    // can short-circuit cheaply.
    if (flag.status === "off") return { enabled: false, source: "status_off" };

    // Rule 2: workspace override.
    const [override] = await this.db
      .select()
      .from(featureFlagWorkspaceOverrides)
      .where(
        and(
          eq(featureFlagWorkspaceOverrides.flagId, flag.id),
          eq(featureFlagWorkspaceOverrides.companyId, input.companyId),
        ),
      )
      .limit(1);

    if (override != null) return { enabled: override.value, source: "override" };

    // Rule 3: status=on.
    if (flag.status === "on") return { enabled: true, source: "status_on" };

    // Rule 4: canary — deterministic hash bucket.
    const hashInput = input.userId ?? input.companyId;
    const bucket = hashWorkspaceToBucket(hashInput, input.flagKey);
    const enabled = bucket < flag.rolloutPercent;
    return { enabled, source: "rollout" };
  }
}

/**
 * Pure (no-DB) evaluation used in unit tests.
 * Accepts a pre-loaded flag row + optional override value.
 */
export function evaluatePure(opts: {
  status: string;
  rolloutPercent: number;
  override?: boolean | null;
  hashInput: string;
  flagKey: string;
}): EvalResult {
  if (opts.status === "off") return { enabled: false, source: "status_off" };
  if (opts.override != null) return { enabled: opts.override, source: "override" };
  if (opts.status === "on") return { enabled: true, source: "status_on" };
  const bucket = hashWorkspaceToBucket(opts.hashInput, opts.flagKey);
  return { enabled: bucket < opts.rolloutPercent, source: "rollout" };
}
