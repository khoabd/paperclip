// Unit tests for the pure GreenfieldStateMachine.
// Covers every legal + illegal directed pair for stage, intake, and recovery transitions.

import { describe, expect, it } from "vitest";
import {
  canTransitionStage,
  canTransitionIntake,
  canApplyRecovery,
  recoveryResultStageStatus,
  isTerminalIntake,
  isTerminalStage,
  STAGE_SEQUENCE,
  type StageStatus,
  type IntakeStatus,
  type RecoveryKind,
} from "../greenfield-state-machine.js";

// ── Stage transitions ─────────────────────────────────────────────────────

describe("canTransitionStage — legal forward edges", () => {
  const legalPairs: [StageStatus, StageStatus][] = [
    ["pending", "running"],
    ["running", "done"],
    ["running", "failed"],
    ["running", "gated"],
    ["gated", "running"],
  ];
  for (const [from, to] of legalPairs) {
    it(`${from} → ${to} is ok`, () => {
      expect(canTransitionStage({ from, to })).toEqual({ ok: true });
    });
  }
});

describe("canTransitionStage — illegal edges", () => {
  const illegalPairs: [StageStatus, StageStatus][] = [
    ["pending", "done"],
    ["pending", "failed"],
    ["pending", "gated"],
    ["done", "pending"],
    ["done", "running"],
    ["done", "failed"],
    ["done", "gated"],
    ["failed", "running"],
    ["failed", "done"],
    ["failed", "gated"],
    ["gated", "done"],
    ["gated", "failed"],
    ["gated", "pending"],
    ["running", "pending"],
  ];
  for (const [from, to] of illegalPairs) {
    it(`${from} → ${to} is rejected`, () => {
      const v = canTransitionStage({ from, to });
      expect(v.ok).toBe(false);
    });
  }

  it("same status is rejected", () => {
    const v = canTransitionStage({ from: "running", to: "running" });
    expect(v.ok).toBe(false);
    expect((v as { ok: false; reason: string }).reason).toMatch(/same/);
  });
});

// ── Intake transitions ────────────────────────────────────────────────────

describe("canTransitionIntake — legal edges", () => {
  const legalPairs: [IntakeStatus, IntakeStatus][] = [
    ["pending", "running"],
    ["running", "gate_pending"],
    ["running", "done"],
    ["running", "aborted"],
    ["gate_pending", "running"],
    ["gate_pending", "aborted"],
  ];
  for (const [from, to] of legalPairs) {
    it(`${from} → ${to} is ok`, () => {
      expect(canTransitionIntake({ from, to })).toEqual({ ok: true });
    });
  }
});

describe("canTransitionIntake — illegal edges", () => {
  const illegalPairs: [IntakeStatus, IntakeStatus][] = [
    ["pending", "done"],
    ["pending", "aborted"],
    ["pending", "gate_pending"],
    ["done", "running"],
    ["done", "aborted"],
    ["aborted", "running"],
    ["aborted", "done"],
    ["gate_pending", "done"],
    ["gate_pending", "pending"],
    ["running", "pending"],
  ];
  for (const [from, to] of illegalPairs) {
    it(`${from} → ${to} is rejected`, () => {
      const v = canTransitionIntake({ from, to });
      expect(v.ok).toBe(false);
    });
  }

  it("same status is rejected", () => {
    const v = canTransitionIntake({ from: "running", to: "running" });
    expect(v.ok).toBe(false);
  });
});

// ── Recovery transitions ──────────────────────────────────────────────────

describe("canApplyRecovery — legal kinds from failed", () => {
  const kinds: RecoveryKind[] = ["retry", "alt_path", "skip", "abort"];
  for (const kind of kinds) {
    it(`failed + ${kind} is ok`, () => {
      expect(canApplyRecovery({ stageStatus: "failed", kind })).toEqual({ ok: true });
    });
  }
});

describe("canApplyRecovery — non-failed stage is rejected", () => {
  const nonFailed: StageStatus[] = ["pending", "running", "done", "gated"];
  for (const stageStatus of nonFailed) {
    it(`${stageStatus} stage cannot be recovered`, () => {
      const v = canApplyRecovery({ stageStatus, kind: "retry" });
      expect(v.ok).toBe(false);
    });
  }
});

describe("recoveryResultStageStatus", () => {
  it("retry → pending", () => expect(recoveryResultStageStatus("retry")).toBe("pending"));
  it("alt_path → pending", () => expect(recoveryResultStageStatus("alt_path")).toBe("pending"));
  it("skip → done", () => expect(recoveryResultStageStatus("skip")).toBe("done"));
  it("abort → failed (intake cascades)", () => expect(recoveryResultStageStatus("abort")).toBe("failed"));
});

// ── Terminal helpers ──────────────────────────────────────────────────────

describe("isTerminalIntake", () => {
  it("done is terminal", () => expect(isTerminalIntake("done")).toBe(true));
  it("aborted is terminal", () => expect(isTerminalIntake("aborted")).toBe(true));
  it("running is not terminal", () => expect(isTerminalIntake("running")).toBe(false));
  it("pending is not terminal", () => expect(isTerminalIntake("pending")).toBe(false));
  it("gate_pending is not terminal", () => expect(isTerminalIntake("gate_pending")).toBe(false));
});

describe("isTerminalStage", () => {
  it("done is terminal", () => expect(isTerminalStage("done")).toBe(true));
  it("failed is terminal", () => expect(isTerminalStage("failed")).toBe(true));
  it("pending is not terminal", () => expect(isTerminalStage("pending")).toBe(false));
  it("running is not terminal", () => expect(isTerminalStage("running")).toBe(false));
  it("gated is not terminal", () => expect(isTerminalStage("gated")).toBe(false));
});

// ── STAGE_SEQUENCE ────────────────────────────────────────────────────────

describe("STAGE_SEQUENCE", () => {
  it("has 7 stages", () => expect(STAGE_SEQUENCE).toHaveLength(7));
  it("starts with idea_refinement", () => expect(STAGE_SEQUENCE[0]).toBe("idea_refinement"));
  it("ends with sprint1", () => expect(STAGE_SEQUENCE[6]).toBe("sprint1"));
  it("has unique names", () => {
    const set = new Set(STAGE_SEQUENCE);
    expect(set.size).toBe(7);
  });
});
