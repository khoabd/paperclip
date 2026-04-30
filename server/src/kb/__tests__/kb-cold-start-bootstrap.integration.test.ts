// Integration test: ColdStartBootstrap end-to-end.
// Gate criterion: feed a synthetic 5-file repo → assert magika_inventory,
// kb_documents, and kb_chunks rows materialize.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb } from "@paperclipai/db";
import { kbRepositories } from "@paperclipai/db/schema/kb_repositories";
import { magikaInventory } from "@paperclipai/db/schema/magika_inventory";
import { kbDocuments } from "@paperclipai/db/schema/kb_documents";
import { kbChunks } from "@paperclipai/db/schema/kb_chunks";
import { kbCoverageGaps } from "@paperclipai/db/schema/kb_coverage_gaps";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { KBColdStartBootstrap } from "../kb-cold-start-bootstrap.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ColdStartBootstrap integration: ${support.reason ?? "unsupported"}`);
}

desc("KBColdStartBootstrap integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let repoId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("kb-bootstrap-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    await db.delete(kbChunks);
    await db.delete(kbCoverageGaps);
    await db.delete(kbDocuments);
    await db.delete(magikaInventory);
    await db.delete(kbRepositories);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedWorkspace() {
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "KBBootstrapCo",
      issuePrefix: `KB${companyId.slice(0, 4).toUpperCase()}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repoId = randomUUID();
    await db.insert(kbRepositories).values({
      id: repoId,
      companyId,
      repoUrl: "https://github.com/test/myrepo",
      name: "myrepo",
      defaultBranch: "main",
      primaryLanguage: "typescript",
      status: "pending",
      createdAt: new Date(),
    });
  }

  const SYNTHETIC_FILES = [
    {
      path: "src/auth.ts",
      content: `
export class AuthService {
  async login(email: string, password: string) {
    return { token: 'jwt' };
  }
  async logout(token: string) {
    return true;
  }
}
`.trim(),
    },
    {
      path: "src/payments.ts",
      content: `
export async function charge(amount: number, currency: string) {
  return { id: 'ch_123', amount, currency };
}
export async function refund(chargeId: string) {
  return { refunded: true };
}
`.trim(),
    },
    {
      path: "src/utils.ts",
      content: `
export const slugify = (s: string) => s.toLowerCase().replace(/\\s+/g, '-');
export type Env = 'dev' | 'staging' | 'prod';
`.trim(),
    },
    {
      path: "README.md",
      content: "# My Repo\n\nA test repository for KB bootstrap.",
    },
    {
      path: "config.json",
      content: JSON.stringify({ port: 3000, db: "postgres" }),
    },
  ];

  it("materialises magika_inventory, kb_documents, and kb_chunks rows", async () => {
    await seedWorkspace();

    const bootstrap = new KBColdStartBootstrap(db);
    const summary = await bootstrap.bootstrap(repoId, companyId, SYNTHETIC_FILES);

    // magika_inventory — all 5 files scanned
    const invRows = await db
      .select()
      .from(magikaInventory)
      .where(eq(magikaInventory.repoId, repoId));
    expect(invRows.length).toBe(5);

    // kb_documents — only non-vendored, non-binary, non-generated indexed
    const docRows = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.repoId, repoId));
    expect(docRows.length).toBeGreaterThanOrEqual(4); // .ts files + README + config

    // kb_chunks — at least one chunk per TS file
    const authDoc = docRows.find((d) => d.path === "src/auth.ts");
    expect(authDoc).toBeDefined();
    const chunkRows = await db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.documentId, authDoc!.id));
    expect(chunkRows.length).toBeGreaterThan(0);

    // Summary counts are consistent
    expect(summary.filesIndexed).toBeGreaterThanOrEqual(4);
    expect(summary.chunkCount).toBeGreaterThan(0);
  });

  it("README.md is indexed with kind=readme", async () => {
    await seedWorkspace();

    const bootstrap = new KBColdStartBootstrap(db);
    await bootstrap.bootstrap(repoId, companyId, SYNTHETIC_FILES);

    const docs = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.repoId, repoId));

    const readme = docs.find((d) => d.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.kind).toBe("readme");
  });

  it("coverage auditor detects missing_adr and missing_api_spec on a code-only repo", async () => {
    await seedWorkspace();

    const bootstrap = new KBColdStartBootstrap(db);
    const summary = await bootstrap.bootstrap(repoId, companyId, SYNTHETIC_FILES);

    // README present in SYNTHETIC_FILES so only adr + api_spec should be gaps
    const gapRows = await db
      .select()
      .from(kbCoverageGaps)
      .where(eq(kbCoverageGaps.repoId, repoId));

    const gapKinds = gapRows.map((g) => g.kind);
    expect(gapKinds).toContain("missing_adr");
    expect(gapKinds).toContain("missing_api_spec");
    expect(summary.gaps).toBeGreaterThanOrEqual(2);
  });

  it("re-running bootstrap is idempotent (upserts, no duplicate rows)", async () => {
    await seedWorkspace();

    const bootstrap = new KBColdStartBootstrap(db);
    await bootstrap.bootstrap(repoId, companyId, SYNTHETIC_FILES);
    await bootstrap.bootstrap(repoId, companyId, SYNTHETIC_FILES);

    const invRows = await db
      .select()
      .from(magikaInventory)
      .where(eq(magikaInventory.repoId, repoId));
    // Should still be 5 (upserted), not 10
    expect(invRows.length).toBe(5);
  });
});
