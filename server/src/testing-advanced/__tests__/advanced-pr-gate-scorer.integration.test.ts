// Integration tests for AdvancedPRGateScorer.
// Gate criteria:
//   1 critical i18n violation + 1 mobile failed → blocked=true,
//   weakDimensions includes both 'i18n' and 'mobile'.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { AdvancedPRGateScorer } from "../advanced-pr-gate-scorer.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";
import { MobileTestStore } from "../mobile-test-store.js";
import { I18nValidator } from "../i18n-validator.js";
import { UXHeuristicJudge } from "../ux-heuristic-judge.js";
import { CrossDeviceMatrix } from "../cross-device-matrix.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping AdvancedPRGateScorer integration: ${support.reason ?? "unsupported"}`);
}

desc("AdvancedPRGateScorer integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let scorer!: AdvancedPRGateScorer;
  let runStore!: TestRunStore;
  let mobileStore!: MobileTestStore;
  let i18nValidator!: I18nValidator;
  let uxJudge!: UXHeuristicJudge;
  let crossDevice!: CrossDeviceMatrix;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("adv-pr-gate-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    scorer = new AdvancedPRGateScorer(db);
    runStore = new TestRunStore(db);
    mobileStore = new MobileTestStore(db);
    i18nValidator = new I18nValidator(db);
    uxJudge = new UXHeuristicJudge(db);
    crossDevice = new CrossDeviceMatrix(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM ux_judge_scores`);
    await db.execute(sql`DELETE FROM i18n_violations`);
    await db.execute(sql`DELETE FROM mobile_test_runs`);
    await db.execute(sql`DELETE FROM cross_device_results`);
    await db.execute(sql`DELETE FROM test_runs`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `AGCo-${prefix}`,
      issuePrefix: `AG${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("critical i18n violation + mobile failed → blocked=true, weakDimensions includes i18n and mobile", async () => {
    const companyId = await seedCompany("main");
    const PR = `pr-adv-${randomUUID().slice(0, 8)}`;

    // i18n run: score=70 (passes threshold) but critical violation
    const i18nRun = await runStore.create({ companyId, dimension: "i18n", prRef: PR });
    await runStore.markPassed(i18nRun.id, 70);
    // Inject a critical i18n violation directly
    await i18nValidator["persistViolation"](i18nRun.id, {
      locale: "ar-SA",
      kind: "rtl_overlap",
      targetSelector: ".main-content",
      expectedText: null,
      actualText: "overlapping RTL text",
      severity: "critical",
    });

    // mobile run: score=80 (passes threshold) but one device failed
    const mobileRun = await runStore.create({ companyId, dimension: "mobile", prRef: PR });
    await runStore.markPassed(mobileRun.id, 80);
    await mobileStore.record(mobileRun.id, {
      platform: "android",
      deviceModel: "Galaxy S22",
      osVersion: "13",
      status: "failed",
      appiumSessionId: "appium-fail-xyz",
    });

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("i18n");
    expect(result.weakDimensions).toContain("mobile");
  });

  it("all dimensions clean → not blocked", async () => {
    const companyId = await seedCompany("clean");
    const PR = `pr-adv-${randomUUID().slice(0, 8)}`;

    // mobile run: score=90, all passed
    const mobileRun = await runStore.create({ companyId, dimension: "mobile", prRef: PR });
    await runStore.markPassed(mobileRun.id, 90);
    await mobileStore.record(mobileRun.id, {
      platform: "ios",
      deviceModel: "iPhone 15",
      osVersion: "17.0",
      status: "passed",
    });

    // i18n run: score=88, no violations
    const i18nRun = await runStore.create({ companyId, dimension: "i18n", prRef: PR });
    await runStore.markPassed(i18nRun.id, 88);

    // ux_judge run: score=85, all scores above 50
    const uxRun = await runStore.create({ companyId, dimension: "ux_judge", prRef: PR });
    await runStore.markPassed(uxRun.id, 85);
    await uxJudge.judge(uxRun.id, "<sc>", "<dom>", async () => [
      { dimension: "clarity", score: 82, reasoning: "Good" },
      { dimension: "hierarchy", score: 78, reasoning: "OK" },
      { dimension: "consistency", score: 90, reasoning: "Excellent" },
      { dimension: "affordance", score: 75, reasoning: "Fine" },
      { dimension: "feedback", score: 70, reasoning: "Adequate" },
      { dimension: "accessibility", score: 65, reasoning: "Passing" },
      { dimension: "delight", score: 85, reasoning: "Nice" },
    ]);

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(false);
    expect(result.weakDimensions).toHaveLength(0);
  });

  it("ux_judge score < 50 for one dimension → blocked, ux_judge in weakDimensions", async () => {
    const companyId = await seedCompany("ux");
    const PR = `pr-adv-${randomUUID().slice(0, 8)}`;

    const uxRun = await runStore.create({ companyId, dimension: "ux_judge", prRef: PR });
    await runStore.markPassed(uxRun.id, 72);
    await uxJudge.judge(uxRun.id, "<sc>", "<dom>", async () => [
      { dimension: "clarity",       score: 80,  reasoning: "Good" },
      { dimension: "hierarchy",     score: 75,  reasoning: "OK" },
      { dimension: "consistency",   score: 90,  reasoning: "Excellent" },
      { dimension: "affordance",    score: 70,  reasoning: "Fine" },
      { dimension: "feedback",      score: 65,  reasoning: "Adequate" },
      { dimension: "accessibility", score: 40,  reasoning: "Poor contrast" }, // below 50 → block
      { dimension: "delight",       score: 85,  reasoning: "Nice" },
    ]);

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("ux_judge");
  });

  it("cross_device diff > 1000 → blocked, cross_device in weakDimensions", async () => {
    const companyId = await seedCompany("cd");
    const PR = `pr-adv-${randomUUID().slice(0, 8)}`;

    const cdRun = await runStore.create({ companyId, dimension: "cross_browser", prRef: PR });
    await runStore.markPassed(cdRun.id, 80);

    // Inject one device that exceeds diff threshold
    await crossDevice.runMatrix(cdRun.id, {
      route: "/home",
      devices: [
        { deviceClass: "wide_desktop", viewport: "1920x1080", browser: "chrome" },
        { deviceClass: "mobile", viewport: "375x667", browser: "safari" },
      ],
      screenshotter: async ({ deviceClass }) => {
        if (deviceClass === "wide_desktop") {
          return { uri: "s3://cd/wide.png", diffPixelCount: 2000 };
        }
        return { uri: "s3://cd/mobile.png", diffPixelCount: 10 };
      },
    });

    const result = await scorer.scoreForPR(PR);

    expect(result.blocked).toBe(true);
    expect(result.weakDimensions).toContain("cross_browser");
  });

  it("no test runs for PR → not blocked, score=0", async () => {
    const result = await scorer.scoreForPR(`pr-adv-nonexistent-${randomUUID()}`);
    expect(result.blocked).toBe(false);
    expect(result.score).toBe(0);
    expect(result.weakDimensions).toHaveLength(0);
  });
});
