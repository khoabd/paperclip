import { describe, expect, it } from "vitest";
import { classifyIntake } from "../intake-classifier.js";

describe("classifyIntake", () => {
  it("forces feedback_release when a release tag is linked", () => {
    const r = classifyIntake({ text: "love the new login UX", linkedReleaseTag: "v2.3.0" });
    expect(r.type).toBe("feedback_release");
    expect(r.source).toBe("linked_release");
  });

  it("forces feedback_feature when a feature key is linked", () => {
    const r = classifyIntake({ text: "this rolls great", linkedFeatureKey: "feat.search.v2" });
    expect(r.type).toBe("feedback_feature");
  });

  it("respects prefilledType regardless of text", () => {
    const r = classifyIntake({ text: "anything", prefilledType: "strategic_input" });
    expect(r.type).toBe("strategic_input");
    expect(r.confidence).toBe(1);
  });

  it("classifies bug_report on repro phrasing", () => {
    const r = classifyIntake({
      text: "Steps to reproduce: open settings, click save, observe stack trace",
    });
    expect(r.type).toBe("bug_report");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("classifies problem on 'broken' / 'not working' phrasing (TC-CP-01)", () => {
    const r = classifyIntake({
      text: "The export is broken — it's not working anymore after last deploy",
    });
    expect(r.type).toBe("problem");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("classifies problem on Vietnamese 'lỗi' / 'không hoạt động' (TC-CP-01)", () => {
    const r = classifyIntake({ text: "Tính năng search bị lỗi, không hoạt động" });
    expect(r.type).toBe("problem");
  });

  it("TC-CP-01 acceptance: covers all 8 IntakeType values", () => {
    const cases: Array<{ text: string; expected: string }> = [
      { text: "The login flow is broken right now", expected: "problem" },
      { text: "Can we add support for SSO?", expected: "feature_request" },
      { text: "Steps to reproduce: see stack trace", expected: "bug_report" },
      { text: "I think the UX feels a bit off, just noting", expected: "feedback_general" },
      { text: "Tested release v3.0.1 — looks fine", expected: "feedback_release" },
      { text: "The export feature since we shipped is great", expected: "feedback_feature" },
      { text: "We should pivot the strategy and double down on enterprise", expected: "strategic_input" },
      { text: "How does the budget calculator work?", expected: "question" },
    ];
    const seen = new Set<string>();
    for (const c of cases) {
      const r = classifyIntake({ text: c.text });
      expect(r.type, `text="${c.text}" expected ${c.expected} got ${r.type}`).toBe(c.expected);
      seen.add(r.type);
    }
    expect(seen.size).toBe(8);
  });

  it("classifies feature_request on 'add support for'", () => {
    const r = classifyIntake({ text: "Can we add support for SAML SSO?" });
    expect(r.type).toBe("feature_request");
  });

  it("classifies question on trailing question mark with no other signal", () => {
    const r = classifyIntake({ text: "How does the budget calculator work?" });
    expect(r.type).toBe("question");
  });

  it("classifies strategic_input on direction language", () => {
    const r = classifyIntake({
      text: "We should pivot the strategy and double down on enterprise.",
    });
    expect(r.type).toBe("strategic_input");
  });

  it("falls back to feedback_general when nothing matches", () => {
    const r = classifyIntake({ text: "hmm" });
    expect(r.type).toBe("feedback_general");
    expect(r.confidence).toBeLessThan(0.7);
  });

  it("returns alternatives sorted by score", () => {
    const r = classifyIntake({
      text: "Add a feature: the export button is broken on mobile",
    });
    expect(r.alternatives.length).toBeGreaterThan(0);
    for (let i = 1; i < r.alternatives.length; i++) {
      expect(r.alternatives[i - 1]!.score).toBeGreaterThanOrEqual(r.alternatives[i]!.score);
    }
  });
});
