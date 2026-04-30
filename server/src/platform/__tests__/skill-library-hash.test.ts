import { describe, expect, it } from "vitest";
import { hashWorkspaceToBucket } from "../skill-library.js";

describe("hashWorkspaceToBucket (FNV-1a canary routing)", () => {
  it("is deterministic for the same workspace+salt", () => {
    const a = hashWorkspaceToBucket("ws-1", "skill.alpha");
    const b = hashWorkspaceToBucket("ws-1", "skill.alpha");
    expect(a).toBe(b);
  });

  it("falls in [0,100)", () => {
    for (let i = 0; i < 1000; i++) {
      const v = hashWorkspaceToBucket(`ws-${i}`, "any-skill");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });

  it("distributes roughly uniformly across 1000 workspaces", () => {
    let underTen = 0;
    for (let i = 0; i < 1000; i++) {
      if (hashWorkspaceToBucket(`ws-${i}`, "skill.x") < 10) underTen++;
    }
    // 10% target with generous tolerance for 1k samples
    expect(underTen).toBeGreaterThan(60);
    expect(underTen).toBeLessThan(140);
  });

  it("differs across salts so canary % isn't correlated across skills", () => {
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const a = hashWorkspaceToBucket(`ws-${i}`, "skill.a") < 10;
      const b = hashWorkspaceToBucket(`ws-${i}`, "skill.b") < 10;
      if (a === b) same++;
    }
    // Independent salts: P(both in or both out of canary 10%) ≈ 0.82.
    // Allow 60% – 95% range.
    expect(same).toBeGreaterThan(120);
    expect(same).toBeLessThan(190);
  });
});
