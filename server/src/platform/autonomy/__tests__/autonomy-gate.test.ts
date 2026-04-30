import { describe, expect, it } from "vitest";
import { AutonomyGate, effectiveMode } from "../autonomy-gate.js";

const gate = new AutonomyGate();

describe("effectiveMode", () => {
  it("picks the least permissive of (autonomy, capability)", () => {
    expect(effectiveMode("trusted", "supervised")).toBe("supervised");
    expect(effectiveMode("supervised", "autonomous")).toBe("supervised");
    expect(effectiveMode("autonomous", "trusted")).toBe("trusted");
    expect(effectiveMode("autonomous", "autonomous")).toBe("autonomous");
    expect(effectiveMode("sandbox", "autonomous")).toBe("sandbox");
  });
});

describe("AutonomyGate.decide", () => {
  it("always gates in sandbox even with high confidence and low risk", () => {
    const r = gate.decide({
      autonomyLevel: "sandbox",
      capabilityMode: "autonomous",
      proposalPattern: "code_change",
      confidence: 0.99,
      riskScore: 0.0,
    });
    expect(r.decision).toBe("gate");
    expect(r.effectiveMode).toBe("sandbox");
  });

  it("auto-approves in autonomous mode for non-always-gate pattern", () => {
    const r = gate.decide({
      autonomyLevel: "autonomous",
      capabilityMode: "autonomous",
      proposalPattern: "code_change",
      confidence: 0.9,
      riskScore: 0.1,
    });
    expect(r.decision).toBe("auto_approve");
  });

  it("forces a gate when risk_score >= 0.85 even in autonomous", () => {
    const r = gate.decide({
      autonomyLevel: "autonomous",
      capabilityMode: "autonomous",
      proposalPattern: "code_change",
      confidence: 0.99,
      riskScore: 0.9,
    });
    expect(r.decision).toBe("gate");
    expect(r.reason).toMatch(/risk_score/);
  });

  it("always gates always-gate patterns regardless of mode", () => {
    const r = gate.decide({
      autonomyLevel: "autonomous",
      capabilityMode: "autonomous",
      proposalPattern: "policy_exception",
      confidence: 0.95,
      riskScore: 0.05,
    });
    expect(r.decision).toBe("gate");
    expect(r.reason).toMatch(/always gates/);
  });

  it("supervised: auto when confidence>=0.80 AND risk<=0.30", () => {
    const r = gate.decide({
      autonomyLevel: "supervised",
      capabilityMode: "supervised",
      proposalPattern: "code_change",
      confidence: 0.85,
      riskScore: 0.2,
    });
    expect(r.decision).toBe("auto_approve");
  });

  it("supervised: gates when confidence < 0.80", () => {
    const r = gate.decide({
      autonomyLevel: "supervised",
      capabilityMode: "supervised",
      proposalPattern: "code_change",
      confidence: 0.7,
      riskScore: 0.1,
    });
    expect(r.decision).toBe("gate");
  });

  it("supervised: gates when risk > 0.30", () => {
    const r = gate.decide({
      autonomyLevel: "supervised",
      capabilityMode: "supervised",
      proposalPattern: "code_change",
      confidence: 0.95,
      riskScore: 0.4,
    });
    expect(r.decision).toBe("gate");
  });

  it("trusted: auto when confidence>=0.60 AND risk<=0.55", () => {
    const r = gate.decide({
      autonomyLevel: "trusted",
      capabilityMode: "trusted",
      proposalPattern: "code_change",
      confidence: 0.65,
      riskScore: 0.5,
    });
    expect(r.decision).toBe("auto_approve");
  });

  it("trusted: gates when confidence < 0.60", () => {
    const r = gate.decide({
      autonomyLevel: "trusted",
      capabilityMode: "trusted",
      proposalPattern: "code_change",
      confidence: 0.4,
      riskScore: 0.1,
    });
    expect(r.decision).toBe("gate");
  });

  it("least-permissive wins: trusted autonomy + supervised capability acts supervised", () => {
    const r = gate.decide({
      autonomyLevel: "trusted",
      capabilityMode: "supervised",
      proposalPattern: "code_change",
      confidence: 0.65, // would auto in trusted, gates in supervised
      riskScore: 0.1,
    });
    expect(r.decision).toBe("gate");
    expect(r.effectiveMode).toBe("supervised");
  });

  it("rejects out-of-range confidence/risk inputs", () => {
    expect(() =>
      gate.decide({
        autonomyLevel: "autonomous",
        capabilityMode: "autonomous",
        proposalPattern: "code_change",
        confidence: 1.5,
        riskScore: 0,
      }),
    ).toThrow();
    expect(() =>
      gate.decide({
        autonomyLevel: "autonomous",
        capabilityMode: "autonomous",
        proposalPattern: "code_change",
        confidence: 0.5,
        riskScore: -0.1,
      }),
    ).toThrow();
  });
});
