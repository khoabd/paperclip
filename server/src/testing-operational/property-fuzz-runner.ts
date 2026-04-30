// PropertyFuzzRunner — Phase 14c §Services.1
//
// Hand-rolled property-based fuzzer with shrinking.
// All DB I/O is isolated; the property function and generators are injected
// so the runner is fully testable without a real DB.
//
// Generator interface: gen<T>(rng: Rng, depth: number) => T
//   depth starts at 0; recursive generators may increment it to limit size.
//
// Shrinking strategy: on failure, halve each numeric input in the failing
// sample iteratively until no smaller reproducer can be found.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { fuzzRunSummaries } from "@paperclipai/db/schema/fuzz_run_summaries";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns an integer in [min, max]. */
  nextInt(min: number, max: number): number;
}

export type Generator<T> = (rng: Rng, depth: number) => T;

export interface FuzzRunInput {
  testRunId: string;
  target: string;
  /** Pure property function — must return true for all valid inputs. */
  propertyFn: (...args: unknown[]) => boolean;
  generators: Generator<unknown>[];
  totalRuns: number;
  /** Optional seed string for reproducibility (informational). */
  seed?: string;
}

export interface FuzzRunResult {
  id: string;
  testRunId: string;
  target: string;
  totalRuns: number;
  failures: number;
  shrunkFailures: number;
  seed: string;
  summary: Record<string, unknown>;
}

export interface FailureSample {
  inputs: unknown[];
  shrunkInputs: unknown[];
}

// ---------------------------------------------------------------------------
// Simple deterministic LCG-based RNG
// ---------------------------------------------------------------------------

function makeLcgRng(seed: number): Rng {
  let state = seed >>> 0;

  return {
    next(): number {
      // LCG parameters from Numerical Recipes
      state = Math.imul(1664525, state) + 1013904223;
      state = state >>> 0;
      return state / 0x100000000;
    },
    nextInt(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

// ---------------------------------------------------------------------------
// Shrinking helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to shrink a single value toward a simpler form.
 * For numbers: halve toward zero.
 * For strings: halve length.
 * For arrays: halve length.
 * Other types: return as-is (no shrink).
 */
function shrinkOne(value: unknown): unknown {
  if (typeof value === "number") {
    if (value === 0) return value;
    if (Number.isInteger(value)) {
      return Math.trunc(value / 2);
    }
    return value / 2;
  }
  if (typeof value === "string") {
    return value.slice(0, Math.max(0, Math.floor(value.length / 2)));
  }
  if (Array.isArray(value)) {
    return value.slice(0, Math.max(0, Math.floor(value.length / 2)));
  }
  return value;
}

/**
 * Shrinks a failing input tuple to the smallest reproducer.
 * Tries shrinking one position at a time; keeps the shrunken version if the
 * property still fails.  Iterates until stable.
 */
function shrinkInputs(
  inputs: unknown[],
  propertyFn: (...args: unknown[]) => boolean,
  maxIterations = 100,
): unknown[] {
  let current = [...inputs];

  for (let iter = 0; iter < maxIterations; iter++) {
    let improved = false;

    for (let i = 0; i < current.length; i++) {
      const candidate = shrinkOne(current[i]);
      if (candidate === current[i]) continue; // no change

      const next = [...current];
      next[i] = candidate;

      let stillFails: boolean;
      try {
        stillFails = !propertyFn(...next);
      } catch {
        stillFails = true;
      }

      if (stillFails) {
        current = next;
        improved = true;
      }
    }

    if (!improved) break;
  }

  return current;
}

// ---------------------------------------------------------------------------
// PropertyFuzzRunner
// ---------------------------------------------------------------------------

export class PropertyFuzzRunner {
  constructor(private readonly db: Db) {}

  /**
   * Runs the fuzz campaign, persists a fuzz_run_summaries row, and returns it.
   *
   * On any property failure the runner immediately shrinks the failing sample
   * and records the shrunk inputs in the summary.
   */
  async runProperty(input: FuzzRunInput): Promise<FuzzRunResult> {
    const {
      testRunId,
      target,
      propertyFn,
      generators,
      totalRuns,
      seed: seedStr,
    } = input;

    // Derive a numeric seed from the seed string (or use a time-based one).
    const numericSeed =
      seedStr != null
        ? seedStr.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
        : Date.now() & 0xffffffff;

    const rng = makeLcgRng(numericSeed);
    const effectiveSeed = seedStr ?? String(numericSeed);

    let failures = 0;
    let shrunkFailures = 0;
    const failureSamples: FailureSample[] = [];

    for (let run = 0; run < totalRuns; run++) {
      // Generate one input tuple
      const inputs = generators.map((g) => g(rng, 0));

      let passed: boolean;
      try {
        passed = propertyFn(...inputs);
      } catch {
        passed = false;
      }

      if (!passed) {
        failures++;
        const shrunk = shrinkInputs(inputs, propertyFn);
        // A shrunk failure is one where the shrunk tuple is genuinely simpler
        const isShrunk =
          shrunk.length > 0 &&
          shrunk.some((v, i) => v !== inputs[i]);
        if (isShrunk) shrunkFailures++;

        failureSamples.push({ inputs, shrunkInputs: shrunk });
      }
    }

    const failureRate = totalRuns > 0 ? failures / totalRuns : 0;
    const summaryPayload: Record<string, unknown> = {
      failureRate,
      failureSamples: failureSamples.slice(0, 10), // cap stored samples
    };

    const [row] = await this.db
      .insert(fuzzRunSummaries)
      .values({
        testRunId,
        target,
        totalRuns,
        failures,
        shrunkFailures,
        seed: effectiveSeed,
        summary: summaryPayload,
      })
      .returning();

    return {
      id: row.id,
      testRunId: row.testRunId,
      target: row.target,
      totalRuns: row.totalRuns,
      failures: row.failures,
      shrunkFailures: row.shrunkFailures,
      seed: row.seed ?? effectiveSeed,
      summary: (row.summary as Record<string, unknown>) ?? summaryPayload,
    };
  }

  /** Fetch all fuzz run summaries for a given test run. */
  async listByTestRun(testRunId: string): Promise<FuzzRunResult[]> {
    const rows = await this.db
      .select()
      .from(fuzzRunSummaries)
      .where(eq(fuzzRunSummaries.testRunId, testRunId));

    return rows.map((row) => ({
      id: row.id,
      testRunId: row.testRunId,
      target: row.target,
      totalRuns: row.totalRuns,
      failures: row.failures,
      shrunkFailures: row.shrunkFailures,
      seed: row.seed ?? "",
      summary: (row.summary as Record<string, unknown>) ?? {},
    }));
  }
}
