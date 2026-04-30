// Unit tests for AutoActionPolicy — pure, no DB.

import { describe, expect, it } from "vitest";
import { AutoActionPolicy } from "../auto-action-policy.js";

const policy = new AutoActionPolicy();

describe("AutoActionPolicy", () => {
  it("escalates security cluster of size 5", () => {
    expect(policy.decide({ category: "security", size: 5, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("tightens security for security cluster of size 4", () => {
    expect(policy.decide({ category: "security", size: 4, windowDays: 14 })).toBe(
      "tighten_security",
    );
  });

  it("escalates spec_violation of size 5", () => {
    expect(policy.decide({ category: "spec_violation", size: 5, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("tightens QA for spec_violation of size 3", () => {
    expect(policy.decide({ category: "spec_violation", size: 3, windowDays: 14 })).toBe(
      "tighten_qa",
    );
  });

  it("escalates design_conflict of size 6", () => {
    expect(policy.decide({ category: "design_conflict", size: 6, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("adjusts principle for design_conflict of size 2", () => {
    expect(policy.decide({ category: "design_conflict", size: 2, windowDays: 14 })).toBe(
      "adjust_principle",
    );
  });

  it("adjusts prompt for wrong_scope of size 4", () => {
    expect(policy.decide({ category: "wrong_scope", size: 4, windowDays: 14 })).toBe(
      "adjust_prompt",
    );
  });

  it("escalates wrong_scope of size 5", () => {
    expect(policy.decide({ category: "wrong_scope", size: 5, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("adjusts velocity for cost cluster of size 3", () => {
    expect(policy.decide({ category: "cost", size: 3, windowDays: 14 })).toBe(
      "adjust_velocity",
    );
  });

  it("escalates cost cluster of size 5", () => {
    expect(policy.decide({ category: "cost", size: 5, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("notifies for tech_debt (non-strategic) regardless of size", () => {
    expect(policy.decide({ category: "tech_debt", size: 10, windowDays: 14 })).toBe("notify");
  });

  it("notifies for missing_context (non-strategic)", () => {
    expect(policy.decide({ category: "missing_context", size: 5, windowDays: 14 })).toBe("notify");
  });

  it("tightens QA for test_gap of size 2", () => {
    expect(policy.decide({ category: "test_gap", size: 2, windowDays: 14 })).toBe("tighten_qa");
  });

  it("notifies for i18n (low priority category)", () => {
    expect(policy.decide({ category: "i18n", size: 4, windowDays: 14 })).toBe("notify");
  });

  it("handles null category as other — escalates if size >= 5", () => {
    expect(policy.decide({ category: null, size: 5, windowDays: 14 })).toBe("escalate_to_intake");
  });

  it("handles undefined category as other — notifies if size < 5", () => {
    expect(policy.decide({ category: undefined, size: 3, windowDays: 14 })).toBe("notify");
  });

  it("escalates other category of size 5", () => {
    expect(policy.decide({ category: "other", size: 5, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("boundary: size exactly 5 with strategic category escalates", () => {
    expect(policy.decide({ category: "timeline", size: 5, windowDays: 14 })).toBe(
      "escalate_to_intake",
    );
  });

  it("boundary: size 4 with strategic category does not escalate", () => {
    // timeline is not in the special-case switch so defaults to adjust_velocity
    expect(policy.decide({ category: "timeline", size: 4, windowDays: 14 })).toBe(
      "adjust_velocity",
    );
  });

  it("tightens QA for accessibility cluster", () => {
    expect(policy.decide({ category: "accessibility", size: 2, windowDays: 14 })).toBe(
      "tighten_qa",
    );
  });
});
