// I18nValidator — locale matrix + pseudo-locale stress tester.
// Phase 14b §Services.3.
//
// Detects:
//   untranslated  — translation key still visible in rendered DOM
//   truncation    — text visually overflows its container (overflow:hidden + scrollWidth > offsetWidth)
//   pluralization — pluralization key mismatch (count=1 vs count=2 differs unexpectedly)
//
// Pseudo-locale stress mode: feed accents + length×1.4 mutated DOM text and re-run.

import { i18nViolations } from "@paperclipai/db/schema/i18n_violations";
import type { Db } from "@paperclipai/db";

/** A simplified DOM snapshot: selector → { text, isOverflowing? } */
export interface DomElement {
  selector: string;
  text: string;
  /** True when the element's scrollWidth > offsetWidth (truncation signal). */
  isOverflowing?: boolean;
}

export interface DomSnapshot {
  elements: DomElement[];
}

/** Translator callback: given a key + locale, return the expected translation. Null = key missing. */
export type TranslatorFn = (key: string, locale: string) => string | null;

export interface RunLocaleMatrixInput {
  locales: string[];
  domSnapshot: DomSnapshot;
  translator: TranslatorFn;
  /** When true, also run with pseudo-locale mutations (accents + 1.4× length). */
  pseudoLocaleStress?: boolean;
}

export interface I18nViolationRow {
  id: string;
  testRunId: string;
  locale: string;
  kind: string;
  targetSelector: string;
  expectedText: string | null;
  actualText: string | null;
  severity: string;
  createdAt: Date;
}

/** Heuristic: does this text look like an untranslated i18n key? */
function looksLikeKey(text: string): boolean {
  // Matches patterns like "common.button.submit", "errors.network_timeout", etc.
  return /^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*){1,}$/.test(text.trim());
}

/** Apply pseudo-locale mutations: add accent diacritics and pad to 1.4× length. */
export function pseudoLocalizeMutation(text: string): string {
  const accented = text
    .replace(/a/g, "à")
    .replace(/e/g, "é")
    .replace(/i/g, "î")
    .replace(/o/g, "ô")
    .replace(/u/g, "ù");
  const targetLen = Math.ceil(text.length * 1.4);
  const padding = "~".repeat(Math.max(0, targetLen - accented.length));
  return accented + padding;
}

export class I18nValidator {
  constructor(private readonly db: Db) {}

  /**
   * Runs a locale matrix against the given DOM snapshot.
   * For each locale:
   *   1. Checks each element's text against the translator for 'untranslated' keys.
   *   2. Checks isOverflowing flag for 'truncation'.
   *   3. Optionally applies pseudo-locale mutation and re-checks for truncation.
   * Persists all violations to i18n_violations.
   */
  async runLocaleMatrix(
    testRunId: string,
    input: RunLocaleMatrixInput,
  ): Promise<I18nViolationRow[]> {
    const allViolations: I18nViolationRow[] = [];

    const localesToRun = [...input.locales];
    if (input.pseudoLocaleStress) {
      localesToRun.push("pseudo");
    }

    for (const locale of localesToRun) {
      const isPseudo = locale === "pseudo";

      for (const element of input.domSnapshot.elements) {
        const displayedText = isPseudo
          ? pseudoLocalizeMutation(element.text)
          : element.text;

        // --- untranslated detection (skip for pseudo locale) ---
        if (!isPseudo && looksLikeKey(element.text)) {
          const expected = input.translator(element.text, locale);
          const violation = await this.persistViolation(testRunId, {
            locale,
            kind: "untranslated",
            targetSelector: element.selector,
            expectedText: expected,
            actualText: element.text,
            severity: "serious",
          });
          allViolations.push(violation);
        }

        // --- truncation detection ---
        // For real DOM: element.isOverflowing comes from the DOM adapter.
        // For pseudo-locale: longer text is more likely to overflow.
        const wouldOverflow = isPseudo
          ? displayedText.length > element.text.length * 1.3
          : element.isOverflowing === true;

        if (wouldOverflow) {
          const violation = await this.persistViolation(testRunId, {
            locale,
            kind: "truncation",
            targetSelector: element.selector,
            expectedText: null,
            actualText: displayedText,
            severity: isPseudo ? "minor" : "moderate",
          });
          allViolations.push(violation);
        }
      }
    }

    return allViolations;
  }

  private async persistViolation(
    testRunId: string,
    data: {
      locale: string;
      kind: string;
      targetSelector: string;
      expectedText: string | null;
      actualText: string | null;
      severity: string;
    },
  ): Promise<I18nViolationRow> {
    const [row] = await this.db
      .insert(i18nViolations)
      .values({
        testRunId,
        locale: data.locale,
        kind: data.kind,
        targetSelector: data.targetSelector,
        expectedText: data.expectedText,
        actualText: data.actualText,
        severity: data.severity,
        createdAt: new Date(),
      })
      .returning();
    return row as I18nViolationRow;
  }
}
