// Integration tests for A11yViolationCollector.
// Gate criteria:
//   5 violations of mixed impact → summary returns correct counts.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { A11yViolationCollector } from "../a11y-violation-collector.js";
import { TestRunStore } from "../test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping A11yViolationCollector integration: ${support.reason ?? "unsupported"}`);
}

desc("A11yViolationCollector integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let collector!: A11yViolationCollector;
  let runStore!: TestRunStore;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("a11y-collector-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    collector = new A11yViolationCollector(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM a11y_violations`);
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
      name: `A11yCo-${prefix}`,
      issuePrefix: `AX${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("5 mixed-impact violations → summary returns correct counts", async () => {
    companyId = await seedCompany("mix");

    const run = await runStore.create({
      companyId,
      dimension: "a11y",
      prRef: "pr-a11y-mix",
    });

    await collector.record(run.id, [
      { ruleId: "color-contrast", impact: "serious", targetSelector: "p.text", helpUrl: "https://axe.dev/r/color-contrast" },
      { ruleId: "image-alt", impact: "critical", targetSelector: "img.logo", htmlSnippet: "<img src='logo.png'>" },
      { ruleId: "label", impact: "minor", targetSelector: "input#name" },
      { ruleId: "link-name", impact: "moderate", targetSelector: "a.nav-link" },
      { ruleId: "aria-required-attr", impact: "critical", targetSelector: "[role='dialog']" },
    ]);

    const summary = await collector.summary(run.id);

    expect(summary.minor).toBe(1);
    expect(summary.moderate).toBe(1);
    expect(summary.serious).toBe(1);
    expect(summary.critical).toBe(2);
    expect(summary.total).toBe(5);
  });

  it("record with empty array is a no-op, summary returns zeros", async () => {
    companyId = await seedCompany("emp");

    const run = await runStore.create({ companyId, dimension: "a11y", prRef: "pr-a11y-empty" });
    await collector.record(run.id, []);

    const summary = await collector.summary(run.id);
    expect(summary.total).toBe(0);
    expect(summary.critical).toBe(0);
  });

  it("summary is scoped to the given test_run_id", async () => {
    companyId = await seedCompany("scop");

    const run1 = await runStore.create({ companyId, dimension: "a11y", prRef: "pr-scope-1" });
    const run2 = await runStore.create({ companyId, dimension: "a11y", prRef: "pr-scope-2" });

    await collector.record(run1.id, [
      { ruleId: "r1", impact: "critical", targetSelector: "div" },
    ]);
    await collector.record(run2.id, [
      { ruleId: "r2", impact: "minor", targetSelector: "span" },
      { ruleId: "r3", impact: "minor", targetSelector: "p" },
    ]);

    const s1 = await collector.summary(run1.id);
    const s2 = await collector.summary(run2.id);

    expect(s1.critical).toBe(1);
    expect(s1.total).toBe(1);
    expect(s2.minor).toBe(2);
    expect(s2.total).toBe(2);
  });
});
