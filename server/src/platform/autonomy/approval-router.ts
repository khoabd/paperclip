// Persists approvals + telemetry. Composes AutonomyGate + ProposalPattern Zod schemas.
// Per Phase-3-Autonomy-Dial-Approval-Patterns §3.2.

import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvalPatternDecisions,
  approvals,
  capabilityRegistry,
  companies,
  workspaceCapabilityOverrides,
} from "@paperclipai/db";
import {
  AutonomyGate,
  type AutonomyLevel,
  type CapabilityMode,
  type GateResult,
} from "./autonomy-gate.js";
import {
  parseProposalPayload,
  PROPOSAL_PATTERN_META,
  type ProposalPayload,
  type ProposalPatternKey,
} from "./proposal-patterns.js";

export interface RouteApprovalInput {
  workspaceId: string;
  type: string;
  payload: unknown;
  /** Required: capability key the action exercises (resolved against capability_registry). */
  capabilityKey: string;
  confidence: number;
  riskScore: number;
  requestedByAgentId?: string | null;
  requestedByUserId?: string | null;
  /** Optional override; otherwise pattern's default priority is used. */
  priority?: "low" | "medium" | "high" | "urgent";
  timeoutMinutes?: number;
}

export interface RouteApprovalResult {
  decision: GateResult;
  approvalId: string | null;
  telemetryId: string;
  proposalPattern: ProposalPatternKey;
}

export class ApprovalRouter {
  private gate = new AutonomyGate();

  constructor(private readonly db: Db) {}

  async route(input: RouteApprovalInput): Promise<RouteApprovalResult> {
    const payload = parseProposalPayload(input.payload) as ProposalPayload;
    const proposalPattern = payload.proposal_pattern;

    const ctx = await this.loadGateContext(input.workspaceId, input.capabilityKey);
    const decision = this.gate.decide({
      autonomyLevel: ctx.autonomyLevel,
      capabilityMode: ctx.capabilityMode,
      proposalPattern,
      confidence: input.confidence,
      riskScore: input.riskScore,
    });

    let approvalId: string | null = null;
    if (decision.decision === "gate") {
      approvalId = await this.persistApproval({
        input,
        proposalPattern,
        payload,
        capabilityId: ctx.capabilityId,
      });
    }

    const telemetryId = await this.persistTelemetry({
      workspaceId: input.workspaceId,
      approvalId,
      proposalPattern,
      autonomyLevel: ctx.autonomyLevel,
      capabilityMode: ctx.capabilityMode,
      decision,
      confidence: input.confidence,
      riskScore: input.riskScore,
    });

    return { decision, approvalId, telemetryId, proposalPattern };
  }

  private async loadGateContext(workspaceId: string, capabilityKey: string) {
    const ws = (
      await this.db.select().from(companies).where(eq(companies.id, workspaceId)).limit(1)
    )[0];
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);

    const cap = (
      await this.db
        .select()
        .from(capabilityRegistry)
        .where(eq(capabilityRegistry.name, capabilityKey))
        .limit(1)
    )[0];
    if (!cap) throw new Error(`capability ${capabilityKey} not registered`);

    const override = (
      await this.db
        .select()
        .from(workspaceCapabilityOverrides)
        .where(
          and(
            eq(workspaceCapabilityOverrides.companyId, workspaceId),
            eq(workspaceCapabilityOverrides.capabilityId, cap.id),
          ),
        )
        .limit(1)
    )[0];

    const capabilityMode = (override?.mode ?? cap.defaultMode) as CapabilityMode;
    const autonomyLevel = (ws.autonomyLevel ?? "sandbox") as AutonomyLevel;
    return { autonomyLevel, capabilityMode, capabilityId: cap.id };
  }

  private async persistApproval(args: {
    input: RouteApprovalInput;
    proposalPattern: ProposalPatternKey;
    payload: ProposalPayload;
    capabilityId: string;
  }): Promise<string> {
    const { input, proposalPattern, payload, capabilityId } = args;
    const meta = PROPOSAL_PATTERN_META[proposalPattern];
    const priority = input.priority ?? meta.defaultPriority;
    const timeoutAt = input.timeoutMinutes
      ? new Date(Date.now() + input.timeoutMinutes * 60_000)
      : null;

    const inserted = await this.db
      .insert(approvals)
      .values({
        companyId: input.workspaceId,
        type: input.type,
        requestedByAgentId: input.requestedByAgentId ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        status: "pending",
        payload: payload as unknown as Record<string, unknown>,
        proposalPattern,
        capabilityId,
        confidence: input.confidence.toFixed(4),
        riskScore: input.riskScore.toFixed(4),
        priority,
        timeoutAt,
      })
      .returning({ id: approvals.id });

    return inserted[0]!.id;
  }

  private async persistTelemetry(args: {
    workspaceId: string;
    approvalId: string | null;
    proposalPattern: ProposalPatternKey;
    autonomyLevel: AutonomyLevel;
    capabilityMode: CapabilityMode;
    decision: GateResult;
    confidence: number;
    riskScore: number;
  }): Promise<string> {
    const inserted = await this.db
      .insert(approvalPatternDecisions)
      .values({
        companyId: args.workspaceId,
        approvalId: args.approvalId,
        proposalPattern: args.proposalPattern,
        autonomyLevel: args.autonomyLevel,
        capabilityMode: args.capabilityMode,
        decision: args.decision.decision,
        reason: args.decision.reason,
        confidence: args.confidence.toFixed(4),
        riskScore: args.riskScore.toFixed(4),
      })
      .returning({ id: approvalPatternDecisions.id });
    return inserted[0]!.id;
  }
}
