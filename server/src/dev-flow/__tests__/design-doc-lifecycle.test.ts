// Pure unit tests for DesignDocStateMachine.
// Covers every legal + illegal edge of the state graph.
// Per Phase-7-Development-Flow-Feature-Flags §7.4.

import { describe, expect, it } from "vitest";
import {
  canTransitionDesignDoc,
  legalRunnerTargets,
  type DesignDocStatus,
} from "../lifecycle/design-doc-state-machine.js";

const NO_CONFLICTS = { noOpenConflicts: true, featureFlagLive: false };
const HAS_CONFLICTS = { noOpenConflicts: false, featureFlagLive: false };
const FLAG_LIVE = { noOpenConflicts: true, featureFlagLive: true };

describe("DesignDocStateMachine", () => {
  describe("same-status guard", () => {
    it("rejects proposed->proposed", () => {
      const r = canTransitionDesignDoc({ from: "proposed", to: "proposed", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(false);
    });
  });

  describe("proposed->review (runner)", () => {
    it("allows the transition", () => {
      const r = canTransitionDesignDoc({ from: "proposed", to: "review", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(true);
    });
    it("user cannot do proposed->review", () => {
      const r = canTransitionDesignDoc({ from: "proposed", to: "review", actor: "user", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(false);
    });
  });

  describe("review->approved (runner)", () => {
    it("allows when no open conflicts", () => {
      const r = canTransitionDesignDoc({ from: "review", to: "approved", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(true);
    });
    it("blocks when open conflicts exist", () => {
      const r = canTransitionDesignDoc({ from: "review", to: "approved", actor: "runner", ctx: HAS_CONFLICTS });
      expect(r.ok).toBe(false);
      expect((r as { ok: false; reason: string }).reason).toMatch(/conflict/i);
    });
  });

  describe("review->proposed (runner — revision)", () => {
    it("allows back to proposed", () => {
      const r = canTransitionDesignDoc({ from: "review", to: "proposed", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(true);
    });
  });

  describe("approved->in_dev (runner)", () => {
    it("allows the transition", () => {
      const r = canTransitionDesignDoc({ from: "approved", to: "in_dev", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(true);
    });
  });

  describe("in_dev->live (runner)", () => {
    it("allows when feature flag is live", () => {
      const r = canTransitionDesignDoc({ from: "in_dev", to: "live", actor: "runner", ctx: FLAG_LIVE });
      expect(r.ok).toBe(true);
    });
    it("blocks when feature flag is not live", () => {
      const r = canTransitionDesignDoc({ from: "in_dev", to: "live", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(false);
      expect((r as { ok: false; reason: string }).reason).toMatch(/feature flag/i);
    });
  });

  describe("live->archived (runner)", () => {
    it("allows archival", () => {
      const r = canTransitionDesignDoc({ from: "live", to: "archived", actor: "runner", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(true);
    });
  });

  describe("user force-archive", () => {
    const statuses: DesignDocStatus[] = ["proposed", "review", "approved", "in_dev", "live"];
    for (const from of statuses) {
      it(`user can archive from ${from}`, () => {
        const r = canTransitionDesignDoc({ from, to: "archived", actor: "user", ctx: NO_CONFLICTS });
        expect(r.ok).toBe(true);
      });
    }
    it("user cannot archive from archived", () => {
      const r = canTransitionDesignDoc({ from: "archived", to: "archived", actor: "user", ctx: NO_CONFLICTS });
      expect(r.ok).toBe(false);
    });
  });

  describe("illegal runner transitions", () => {
    const illegal: [DesignDocStatus, DesignDocStatus][] = [
      ["proposed", "approved"],
      ["proposed", "in_dev"],
      ["proposed", "live"],
      ["approved", "review"],
      ["approved", "proposed"],
      ["in_dev", "review"],
      ["in_dev", "approved"],
      ["live", "in_dev"],
      ["archived", "proposed"],
    ];
    for (const [from, to] of illegal) {
      it(`runner cannot do ${from}->${to}`, () => {
        const r = canTransitionDesignDoc({ from, to, actor: "runner", ctx: FLAG_LIVE });
        expect(r.ok).toBe(false);
      });
    }
  });

  describe("legalRunnerTargets", () => {
    it("proposed can go to review", () => {
      expect(legalRunnerTargets("proposed")).toEqual(["review"]);
    });
    it("archived has no targets", () => {
      expect(legalRunnerTargets("archived")).toEqual([]);
    });
    it("review can go to approved or proposed", () => {
      expect(legalRunnerTargets("review")).toContain("approved");
      expect(legalRunnerTargets("review")).toContain("proposed");
    });
  });
});
