// Integration tests for VectorClockAuditor.
// Gate criteria:
//   bump + compare returns before/after/concurrent correctly.
//   staleAudit returns clocks idle > 2h.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
} from "@paperclipai/db";
import { vectorClocks } from "@paperclipai/db/schema/vector_clocks";
import { eq, sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { VectorClockAuditor } from "../vector-clock-auditor.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping VectorClockAuditor integration: ${support.reason ?? "unsupported"}`);
}

desc("VectorClockAuditor integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let auditor!: VectorClockAuditor;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("vector-clock-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    auditor = new VectorClockAuditor(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM vector_clocks`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `VCCo-${prefix}`,
      issuePrefix: `VC${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("bump creates new clock row for new scope", async () => {
    companyId = await seedCompany("new");
    const clock = await auditor.bump(companyId, "brain", "snap-1", "agent.architect");
    expect(clock["agent.architect"]).toBe(1);

    const rows = await db.select().from(vectorClocks).where(eq(vectorClocks.companyId, companyId));
    expect(rows.length).toBe(1);
    expect((rows[0].clock as Record<string, number>)["agent.architect"]).toBe(1);
  });

  it("bump increments existing node counter", async () => {
    companyId = await seedCompany("inc");
    await auditor.bump(companyId, "brain", "snap-1", "agent.architect");
    await auditor.bump(companyId, "brain", "snap-1", "agent.architect");
    const clock = await auditor.bump(companyId, "brain", "snap-1", "agent.architect");
    expect(clock["agent.architect"]).toBe(3);
  });

  it("bump tracks multiple nodes independently", async () => {
    companyId = await seedCompany("multi");
    await auditor.bump(companyId, "brain", "snap-1", "agent.architect");
    await auditor.bump(companyId, "brain", "snap-1", "rag.index_1");
    const clock = await auditor.bump(companyId, "brain", "snap-1", "agent.engineer");
    expect(clock["agent.architect"]).toBe(1);
    expect(clock["rag.index_1"]).toBe(1);
    expect(clock["agent.engineer"]).toBe(1);
  });

  describe("compare (pure, no DB)", () => {
    const unit = new VectorClockAuditor(null as unknown as ReturnType<typeof createDb>);

    it("before: a happened strictly before b", () => {
      const a = { "n1": 1, "n2": 2 };
      const b = { "n1": 2, "n2": 3 };
      expect(unit.compare(a, b)).toBe("before");
    });

    it("after: a happened strictly after b", () => {
      const a = { "n1": 3, "n2": 4 };
      const b = { "n1": 1, "n2": 2 };
      expect(unit.compare(a, b)).toBe("after");
    });

    it("concurrent: diverged", () => {
      const a = { "n1": 2, "n2": 1 };
      const b = { "n1": 1, "n2": 2 };
      expect(unit.compare(a, b)).toBe("concurrent");
    });

    it("concurrent: identical clocks", () => {
      const a = { "n1": 1 };
      const b = { "n1": 1 };
      expect(unit.compare(a, b)).toBe("concurrent");
    });

    it("before: a missing node (treated as 0) vs b having it", () => {
      const a = { "n1": 1 };
      const b = { "n1": 2, "n2": 1 };
      expect(unit.compare(a, b)).toBe("before");
    });

    it("after: b missing node (treated as 0) vs a having it", () => {
      const a = { "n1": 2, "n2": 1 };
      const b = { "n1": 1 };
      expect(unit.compare(a, b)).toBe("after");
    });
  });

  it("staleAudit returns clocks idle > 2h", async () => {
    companyId = await seedCompany("stale");

    // Insert stale clock (3h ago) via raw SQL to control last_updated_at
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await db.execute(
      sql`INSERT INTO vector_clocks (company_id, scope, scope_id, clock, last_updated_at)
          VALUES (${companyId}, 'brain', 'snap-old', '{"n1":1}'::jsonb, ${staleTime.toISOString()}::timestamptz)`,
    );

    // Insert fresh clock via bump (sets last_updated_at = now())
    await auditor.bump(companyId, "brain", "snap-new", "n1");

    const stale = await auditor.staleAudit(companyId);
    expect(stale.length).toBe(1);
    expect(stale[0].scopeId).toBe("snap-old");
  });

  it("staleAudit returns empty when all clocks are fresh", async () => {
    companyId = await seedCompany("fresh");
    await auditor.bump(companyId, "brain", "snap-1", "n1");

    const stale = await auditor.staleAudit(companyId);
    expect(stale.length).toBe(0);
  });
});
