import { z } from "zod";

export const APPROVAL_PROPOSAL_PATTERNS = ["confirm", "choose", "edit", "decide"] as const;
export type ApprovalProposalPattern = (typeof APPROVAL_PROPOSAL_PATTERNS)[number];

export const APPROVAL_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type ApprovalRiskLevel = (typeof APPROVAL_RISK_LEVELS)[number];

export const APPROVAL_TIMEOUT_ACTIONS = ["auto_approve", "auto_reject", "escalate"] as const;
export type ApprovalTimeoutAction = (typeof APPROVAL_TIMEOUT_ACTIONS)[number];

export const APPROVAL_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type ApprovalPriority = (typeof APPROVAL_PRIORITIES)[number];

const ConfirmPayload = z.object({
  action: z.object({
    kind: z.string().min(1),
    summary: z.string().min(1),
    preview: z.unknown().optional(),
  }),
});

const ChoosePayload = z.object({
  options: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        summary: z.string().min(1),
        costEstimateUsd: z.number().nonnegative().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(2)
    .max(7),
});

const EditPayload = z
  .object({
    draft: z.unknown(),
    schema: z.unknown(),
    notes: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!("draft" in value) || value.draft === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["draft"],
        message: "draft is required",
      });
    }
    if (!("schema" in value) || value.schema === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schema"],
        message: "schema is required",
      });
    }
  });

const DecidePayload = z.object({
  context: z.string().min(1),
  questions: z.array(z.string()).optional(),
});

export const ApprovalPayloadByPattern = z.discriminatedUnion("pattern", [
  z.object({ pattern: z.literal("confirm"), payload: ConfirmPayload }),
  z.object({ pattern: z.literal("choose"), payload: ChoosePayload }),
  z.object({ pattern: z.literal("edit"), payload: EditPayload }),
  z.object({ pattern: z.literal("decide"), payload: DecidePayload }),
]);

export type ApprovalPayloadInput = z.infer<typeof ApprovalPayloadByPattern>;

export function validateApprovalPayload(
  pattern: ApprovalProposalPattern,
  payload: unknown,
): { ok: true; data: ApprovalPayloadInput } | { ok: false; error: z.ZodError } {
  const result = ApprovalPayloadByPattern.safeParse({ pattern, payload });
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}

export const ApprovalRiskMetadata = z
  .object({
    riskFactors: z
      .array(
        z.object({
          code: z.string(),
          weight: z.number().min(0).max(1),
          rationale: z.string().optional(),
        }),
      )
      .optional(),
    dragIn: z.boolean().optional(),
    surface: z.string().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

export type ApprovalRiskMetadataInput = z.infer<typeof ApprovalRiskMetadata>;

export {
  ConfirmPayload as ApprovalConfirmPayload,
  ChoosePayload as ApprovalChoosePayload,
  EditPayload as ApprovalEditPayload,
  DecidePayload as ApprovalDecidePayload,
};
