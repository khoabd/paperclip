// Integration tests for I18nValidator.
// Gate criteria:
//   3 locales × 1 page; inject 1 untranslated key → 1 violation row per locale.
//   Pseudo-locale mutation increases length × 1.4 → optional truncation violations.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql, eq } from "drizzle-orm";
import { i18nViolations } from "@paperclipai/db/schema/i18n_violations";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { I18nValidator, pseudoLocalizeMutation } from "../i18n-validator.js";
import { TestRunStore } from "../../testing-foundation/test-run-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping I18nValidator integration: ${support.reason ?? "unsupported"}`);
}

desc("I18nValidator integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let validator!: I18nValidator;
  let runStore!: TestRunStore;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("i18n-validator-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    validator = new I18nValidator(db);
    runStore = new TestRunStore(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM i18n_violations`);
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
      name: `I18nCo-${prefix}`,
      issuePrefix: `I1${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("1 untranslated key across 3 locales → 3 violation rows (one per locale)", async () => {
    const companyId = await seedCompany("key");
    const run = await runStore.create({
      companyId,
      dimension: "i18n",
      prRef: `pr-i18n-${randomUUID().slice(0, 8)}`,
    });

    // DOM has one element with a raw i18n key (untranslated)
    const domSnapshot = {
      elements: [
        { selector: "button.submit", text: "common.button.submit" },  // untranslated key
        { selector: "h1.title", text: "Welcome" },                     // normal text
      ],
    };

    // Translator returns a translation for the key (so we know expected vs actual)
    const translator = (key: string, locale: string): string | null => {
      const translations: Record<string, Record<string, string>> = {
        "common.button.submit": { "en-US": "Submit", "fr-FR": "Soumettre", "de-DE": "Einreichen" },
      };
      return translations[key]?.[locale] ?? null;
    };

    const violations = await validator.runLocaleMatrix(run.id, {
      locales: ["en-US", "fr-FR", "de-DE"],
      domSnapshot,
      translator,
    });

    // 1 untranslated key × 3 locales = 3 violations
    expect(violations).toHaveLength(3);
    for (const v of violations) {
      expect(v.kind).toBe("untranslated");
      expect(v.targetSelector).toBe("button.submit");
      expect(v.actualText).toBe("common.button.submit");
      expect(v.severity).toBe("serious");
    }
    // Verify locales covered
    const localesFound = violations.map((v) => v.locale).sort();
    expect(localesFound).toEqual(["de-DE", "en-US", "fr-FR"]);

    // Verify persisted to DB
    const dbRows = await db
      .select()
      .from(i18nViolations)
      .where(eq(i18nViolations.testRunId, run.id));
    expect(dbRows).toHaveLength(3);
  });

  it("truncation violation detected from isOverflowing flag", async () => {
    const companyId = await seedCompany("trunc");
    const run = await runStore.create({
      companyId,
      dimension: "i18n",
      prRef: `pr-i18n-${randomUUID().slice(0, 8)}`,
    });

    const domSnapshot = {
      elements: [
        { selector: "nav.breadcrumb", text: "Settings / Account", isOverflowing: true },
        { selector: "p.body", text: "Normal text", isOverflowing: false },
      ],
    };

    const translator = () => null;

    const violations = await validator.runLocaleMatrix(run.id, {
      locales: ["en-US"],
      domSnapshot,
      translator,
    });

    const truncations = violations.filter((v) => v.kind === "truncation");
    expect(truncations).toHaveLength(1);
    expect(truncations[0].targetSelector).toBe("nav.breadcrumb");
    expect(truncations[0].severity).toBe("moderate");
  });

  it("pseudo-locale stress mode: mutated text (1.4×) triggers optional truncation violations", async () => {
    const companyId = await seedCompany("psl");
    const run = await runStore.create({
      companyId,
      dimension: "i18n",
      prRef: `pr-i18n-${randomUUID().slice(0, 8)}`,
    });

    // Short text won't trigger truncation; use longer text for the pseudo-locale mutation test
    const domSnapshot = {
      elements: [
        { selector: "button.long", text: "Submit Payment Now" },
      ],
    };

    const translator = () => null;

    const violations = await validator.runLocaleMatrix(run.id, {
      locales: ["en-US"],
      domSnapshot,
      translator,
      pseudoLocaleStress: true,
    });

    // Pseudo-locale violations should have severity='minor'
    const pseudoViolations = violations.filter((v) => v.locale === "pseudo");
    for (const v of pseudoViolations) {
      expect(v.severity).toBe("minor");
      expect(v.kind).toBe("truncation");
    }

    // Verify pseudoLocalizeMutation length is at least 1.4× input
    const original = "Submit Payment Now";
    const mutated = pseudoLocalizeMutation(original);
    expect(mutated.length).toBeGreaterThanOrEqual(Math.ceil(original.length * 1.4));
  });

  it("clean DOM with no keys and no overflow → no violations", async () => {
    const companyId = await seedCompany("clean");
    const run = await runStore.create({
      companyId,
      dimension: "i18n",
      prRef: `pr-i18n-${randomUUID().slice(0, 8)}`,
    });

    const domSnapshot = {
      elements: [
        { selector: "h1", text: "Dashboard", isOverflowing: false },
        { selector: "p.intro", text: "Welcome back to your account.", isOverflowing: false },
      ],
    };

    const violations = await validator.runLocaleMatrix(run.id, {
      locales: ["en-US", "fr-FR"],
      domSnapshot,
      translator: () => null,
    });

    expect(violations).toHaveLength(0);
  });
});
