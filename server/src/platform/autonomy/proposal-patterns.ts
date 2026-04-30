// Discriminated union of approval payload shapes.
// Each pattern has its own Zod schema. The discriminator is `proposal_pattern`.
// Per ADR-0009 and Phase-3-Autonomy-Dial-Approval-Patterns §3.2.

import { z } from "zod";

const baseFields = {
  summary: z.string().min(1).max(500),
  rationale: z.string().min(1).max(2000),
};

export const codeChangeProposalSchema = z.object({
  proposal_pattern: z.literal("code_change"),
  ...baseFields,
  repo: z.string().min(1),
  branch: z.string().min(1),
  diff: z.string().min(1),
  filesChanged: z.array(z.string()).default([]),
});

export const externalActionProposalSchema = z.object({
  proposal_pattern: z.literal("external_action"),
  ...baseFields,
  toolKey: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  externalSystem: z.string().min(1),
});

export const policyExceptionProposalSchema = z.object({
  proposal_pattern: z.literal("policy_exception"),
  ...baseFields,
  capabilityKey: z.string().min(1),
  durationMinutes: z.number().int().positive().max(7 * 24 * 60),
});

export const costBurstProposalSchema = z.object({
  proposal_pattern: z.literal("cost_burst"),
  ...baseFields,
  projectedUsd: z.number().nonnegative(),
  weeklyBudgetUsd: z.number().nonnegative(),
  overshootRatio: z.number().nonnegative(),
});

export const dataExportProposalSchema = z.object({
  proposal_pattern: z.literal("data_export"),
  ...baseFields,
  destination: z.string().min(1),
  scope: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
});

export const proposalPayloadSchema = z.discriminatedUnion("proposal_pattern", [
  codeChangeProposalSchema,
  externalActionProposalSchema,
  policyExceptionProposalSchema,
  costBurstProposalSchema,
  dataExportProposalSchema,
]);

export type ProposalPayload = z.infer<typeof proposalPayloadSchema>;
export type ProposalPatternKey = ProposalPayload["proposal_pattern"];

export interface ProposalPatternMeta {
  alwaysGate: boolean;
  defaultPriority: "low" | "medium" | "high" | "urgent";
}

export const PROPOSAL_PATTERN_META: Record<ProposalPatternKey, ProposalPatternMeta> = {
  code_change: { alwaysGate: false, defaultPriority: "medium" },
  external_action: { alwaysGate: false, defaultPriority: "high" },
  policy_exception: { alwaysGate: true, defaultPriority: "high" },
  cost_burst: { alwaysGate: false, defaultPriority: "high" },
  data_export: { alwaysGate: true, defaultPriority: "high" },
};

export function parseProposalPayload(input: unknown): ProposalPayload {
  return proposalPayloadSchema.parse(input);
}
