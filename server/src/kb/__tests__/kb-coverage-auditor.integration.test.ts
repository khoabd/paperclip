// Integration test: KBCoverageAuditor.
// Gate criterion: audit a repo missing README → at least 1 gap with kind=missing_readme.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb } from "@paperclipai/db";
import { kbRepositories } from "@paperclipai/db/schema/kb_repositories";
import { kbDocuments } from "@paperclipai/db/schema/kb_documents";
import { kbCoverageGaps } from "@paperclipai/db/schema/kb_coverage_gaps";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { KBCoverageAuditor } from "../kb-coverage-auditor.js";
import { KBDocumentStore } from "../kb-document-store.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping KBCoverageAuditor integration: ${support.reason ?? "unsupported"}`);
}

desc("KBCoverageAuditor integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let repoId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("kb-auditor-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    await db.delete(kbCoverageGaps);
    await db.delete(kbDocuments);
    await db.delete(kbRepositories);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace(): Promise<void> {
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "AuditorCo",
      issuePrefix: `AU${companyId.slice(0, 4).toUpperCase()}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoId = randomUUID();
    await db.insert(kbRepositories).values({
      id: repoId,
      companyId,
      repoUrl: "https://github.com/test/audit-repo",
      name: "audit-repo",
      status: "indexed",
      createdAt: new Date(),
    });
  }

  it("detects missing_readme when no readme doc exists", async () => {
    await seedWorkspace();
    const auditor = new KBCoverageAuditor(db);

    // Repo has only a code doc — no readme
    const store = new KBDocumentStore(db);
    await store.createDoc({
      companyId,
      repoId,
      kind: "code",
      path: "src/index.ts",
      language: "typescript",
      body: "export const x = 1;",
    });

    const gapCount = await auditor.audit(repoId, companyId);
    expect(gapCount).toBeGreaterThanOrEqual(1);

    const gaps = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.repoId, repoId));
    const gapKinds = gaps.map((g) => g.kind);
    expect(gapKinds).toContain("missing_readme");
  });

  it("detects all 3 structural gaps on a code-only repo", async () => {
    await seedWorkspace();
    const auditor = new KBCoverageAuditor(db);

    const store = new KBDocumentStore(db);
    await store.createDoc({
      companyId,
      repoId,
      kind: "code",
      path: "src/main.ts",
      language: "typescript",
      body: "export {}",
    });

    await auditor.audit(repoId, companyId);

    const gaps = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.repoId, repoId));
    const gapKinds = gaps.map((g) => g.kind);
    expect(gapKinds).toContain("missing_readme");
    expect(gapKinds).toContain("missing_adr");
    expect(gapKinds).toContain("missing_api_spec");
  });

  it("does not flag missing_readme when readme doc exists", async () => {
    await seedWorkspace();
    const auditor = new KBCoverageAuditor(db);

    const store = new KBDocumentStore(db);
    await store.createDoc({
      companyId,
      repoId,
      kind: "readme",
      path: "README.md",
      body: "# Repo",
    });

    await auditor.audit(repoId, companyId);

    const gaps = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.repoId, repoId));
    const gapKinds = gaps.map((g) => g.kind);
    expect(gapKinds).not.toContain("missing_readme");
  });

  it("detects stale_doc gap for documents with status=stale", async () => {
    await seedWorkspace();
    const auditor = new KBCoverageAuditor(db);

    // Insert a stale document directly
    await db.insert(kbDocuments).values({
      id: randomUUID(),
      companyId,
      repoId,
      kind: "readme",
      path: "README.md",
      status: "stale",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await auditor.audit(repoId, companyId);

    const gaps = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.repoId, repoId));
    const staleDocs = gaps.filter((g) => g.kind === "stale_doc");
    expect(staleDocs.length).toBeGreaterThanOrEqual(1);
    expect(staleDocs[0]!.targetPath).toBe("README.md");
  });

  it("resolveGap marks the gap resolved with a timestamp", async () => {
    await seedWorkspace();
    const auditor = new KBCoverageAuditor(db);

    const store = new KBDocumentStore(db);
    await store.createDoc({
      companyId,
      repoId,
      kind: "code",
      path: "src/x.ts",
      body: "export {}",
    });

    await auditor.audit(repoId, companyId);

    const gaps = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.repoId, repoId));
    const gap = gaps[0]!;

    await auditor.resolveGap(gap.id);

    const updated = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.id, gap.id));
    expect(updated[0]!.status).toBe("resolved");
    expect(updated[0]!.resolvedAt).not.toBeNull();
  });
});
