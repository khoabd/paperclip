// ConflictDetector: regex-based detection of 4 conflict kinds between design docs.
// Pure detection logic + a DB-backed runOnDesignDoc() that persists conflict_events rows.
// Per Phase-7-Development-Flow-Feature-Flags §7.2.

import { and, eq, inArray, not } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { designDocs, conflictEvents } from "@paperclipai/db";

export type ConflictKind = "schema" | "api" | "ui" | "behavior";

export interface ConflictDraft {
  kind: ConflictKind;
  detail: {
    token: string;
    matchA: string;
    matchB: string;
  };
}

// ─── Pure detection helpers ────────────────────────────────────────────────

/** Extract CREATE TABLE tokens (e.g. "CREATE TABLE foo"). */
function extractSchemaTables(body: string): string[] {
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1].toLowerCase());
  }
  // Also catch ALTER TABLE ... ADD COLUMN patterns.
  const alter = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN/gi;
  while ((m = alter.exec(body)) !== null) {
    if (m[1]) out.push(m[1].toLowerCase());
  }
  return out;
}

/** Extract API route signatures like "GET /api/foo" or "POST /v1/bar". */
function extractApiRoutes(body: string): string[] {
  const re = /\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/[\w/:{}-]+)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] && m[2]) out.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return out;
}

/** Extract component: tokens like "component: CheckoutFlow". */
function extractComponentTokens(body: string): string[] {
  const re = /component:\s*([\w/.:-]+)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1].toLowerCase());
  }
  return out;
}

/** Extract feature_key: tokens like "feature_key: dark_mode". */
function extractFeatureKeyTokens(body: string): string[] {
  const re = /feature_key:\s*([\w-]+)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1].toLowerCase());
  }
  return out;
}

function intersection(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/**
 * Detect conflicts between two design doc bodies.
 * Returns an array of ConflictDraft (may be empty).
 */
export function detectConflicts(bodyA: string, bodyB: string): ConflictDraft[] {
  const out: ConflictDraft[] = [];

  // Schema conflicts: same table referenced in both.
  const schemaA = extractSchemaTables(bodyA);
  const schemaB = extractSchemaTables(bodyB);
  const schemaTouched = intersection(schemaA, schemaB);
  for (const token of schemaTouched) {
    out.push({
      kind: "schema",
      detail: { token, matchA: `table:${token}`, matchB: `table:${token}` },
    });
  }

  // API conflicts: same route signature in both.
  const apiA = extractApiRoutes(bodyA);
  const apiB = extractApiRoutes(bodyB);
  const apiTouched = intersection(apiA, apiB);
  for (const token of apiTouched) {
    out.push({
      kind: "api",
      detail: { token, matchA: token, matchB: token },
    });
  }

  // UI conflicts: same component: token in both.
  const uiA = extractComponentTokens(bodyA);
  const uiB = extractComponentTokens(bodyB);
  const uiTouched = intersection(uiA, uiB);
  for (const token of uiTouched) {
    out.push({
      kind: "ui",
      detail: { token, matchA: `component:${token}`, matchB: `component:${token}` },
    });
  }

  // Behavior conflicts: same feature_key: token in both.
  const fkA = extractFeatureKeyTokens(bodyA);
  const fkB = extractFeatureKeyTokens(bodyB);
  const fkTouched = intersection(fkA, fkB);
  for (const token of fkTouched) {
    out.push({
      kind: "behavior",
      detail: { token, matchA: `feature_key:${token}`, matchB: `feature_key:${token}` },
    });
  }

  return out;
}

// ─── DB-backed runner ──────────────────────────────────────────────────────

export class ConflictDetector {
  constructor(private readonly db: Db) {}

  /**
   * Run conflict detection for a given design doc against all other non-archived docs
   * in the same workspace. Persists conflict_events rows and returns count written.
   */
  async runOnDesignDoc(designDocId: string): Promise<number> {
    const [target] = await this.db
      .select()
      .from(designDocs)
      .where(eq(designDocs.id, designDocId))
      .limit(1);

    if (!target) throw new Error(`design doc ${designDocId} not found`);

    // Load all other non-archived docs in the same workspace.
    const others = await this.db
      .select()
      .from(designDocs)
      .where(
        and(
          eq(designDocs.companyId, target.companyId),
          not(eq(designDocs.id, designDocId)),
          not(inArray(designDocs.status, ["archived"])),
        ),
      );

    let written = 0;
    for (const other of others) {
      const drafts = detectConflicts(target.body, other.body);
      for (const draft of drafts) {
        await this.db.insert(conflictEvents).values({
          companyId: target.companyId,
          kind: draft.kind,
          designDocAId: target.id,
          designDocBId: other.id,
          detail: draft.detail,
        });
        written++;
      }
    }

    return written;
  }
}
