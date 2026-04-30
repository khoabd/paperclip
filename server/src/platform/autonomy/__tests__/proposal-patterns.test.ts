import { describe, expect, it } from "vitest";
import {
  PROPOSAL_PATTERN_META,
  parseProposalPayload,
  proposalPayloadSchema,
} from "../proposal-patterns.js";

describe("proposalPayloadSchema", () => {
  it("accepts a valid code_change payload", () => {
    const parsed = parseProposalPayload({
      proposal_pattern: "code_change",
      summary: "Refactor login flow",
      rationale: "Reduces duplicated session check across pages",
      repo: "paperclip",
      branch: "ai/refactor-login",
      diff: "diff --git a/foo b/foo\n…",
      filesChanged: ["server/src/auth.ts"],
    });
    expect(parsed.proposal_pattern).toBe("code_change");
  });

  it("accepts a valid external_action payload", () => {
    const parsed = parseProposalPayload({
      proposal_pattern: "external_action",
      summary: "Open MR on gitlab",
      rationale: "Needed for repo X release",
      toolKey: "gitlab.openMR",
      params: { repo: "abc", title: "release" },
      externalSystem: "gitlab",
    });
    expect(parsed.proposal_pattern).toBe("external_action");
  });

  it("accepts a valid policy_exception payload", () => {
    const parsed = parseProposalPayload({
      proposal_pattern: "policy_exception",
      summary: "Run prod migration",
      rationale: "off-hours data fix; ticket OPS-123",
      capabilityKey: "db.migrate.prod",
      durationMinutes: 90,
    });
    expect(parsed.proposal_pattern).toBe("policy_exception");
  });

  it("accepts a valid cost_burst payload", () => {
    const parsed = parseProposalPayload({
      proposal_pattern: "cost_burst",
      summary: "Burst over budget",
      rationale: "Backfill embeddings",
      projectedUsd: 250,
      weeklyBudgetUsd: 100,
      overshootRatio: 2.5,
    });
    expect(parsed.proposal_pattern).toBe("cost_burst");
  });

  it("accepts a valid data_export payload", () => {
    const parsed = parseProposalPayload({
      proposal_pattern: "data_export",
      summary: "Export embeddings to S3",
      rationale: "Customer-requested archive",
      destination: "s3://acme-archive/2026Q1",
      scope: "documents+embeddings",
      bytes: 1_073_741_824,
    });
    expect(parsed.proposal_pattern).toBe("data_export");
  });

  it("rejects an unknown proposal_pattern", () => {
    expect(() =>
      parseProposalPayload({
        proposal_pattern: "not-a-real-pattern",
        summary: "x",
        rationale: "x",
      }),
    ).toThrow();
  });

  it("rejects code_change payload missing required fields", () => {
    const result = proposalPayloadSchema.safeParse({
      proposal_pattern: "code_change",
      summary: "missing branch and diff",
      rationale: "boom",
      repo: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects policy_exception with negative duration", () => {
    const result = proposalPayloadSchema.safeParse({
      proposal_pattern: "policy_exception",
      summary: "neg",
      rationale: "neg",
      capabilityKey: "x",
      durationMinutes: -1,
    });
    expect(result.success).toBe(false);
  });

  it("flags policy_exception and data_export as always-gate", () => {
    expect(PROPOSAL_PATTERN_META.policy_exception.alwaysGate).toBe(true);
    expect(PROPOSAL_PATTERN_META.data_export.alwaysGate).toBe(true);
    expect(PROPOSAL_PATTERN_META.code_change.alwaysGate).toBe(false);
  });
});
