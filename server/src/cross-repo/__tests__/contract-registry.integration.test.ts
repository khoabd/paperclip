// Integration tests for ContractRegistry.
// Gate criteria:
//   register v1 → deprecate v1 with replacement → findActive returns only active versions.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
} from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { contractVersions } from "@paperclipai/db/schema/contract_versions";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { ContractRegistry } from "../contract-registry.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping ContractRegistry integration: ${support.reason ?? "unsupported"}`);
}

desc("ContractRegistry integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let registry!: ContractRegistry;
  let companyId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("contract-registry-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    registry = new ContractRegistry(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM contract_versions`);
    await db.execute(sql`DELETE FROM kb_repositories`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `ContractCo-${prefix}`,
      issuePrefix: `CV${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("registers a new contract version", async () => {
    companyId = await seedCompany("reg");
    const row = await registry.register({
      companyId,
      kind: "api",
      name: "payments-api",
      version: "v1",
      schemaHash: "sha256:abc123",
    });

    expect(row.companyId).toBe(companyId);
    expect(row.kind).toBe("api");
    expect(row.name).toBe("payments-api");
    expect(row.version).toBe("v1");
    expect(row.schemaHash).toBe("sha256:abc123");
    expect(row.deprecatedAt).toBeNull();
  });

  it("register is idempotent — returns existing row on duplicate", async () => {
    companyId = await seedCompany("idem");
    const first = await registry.register({
      companyId,
      kind: "event",
      name: "order.created",
      version: "1.0",
    });

    const second = await registry.register({
      companyId,
      kind: "event",
      name: "order.created",
      version: "1.0",
    });

    expect(second.id).toBe(first.id);
  });

  it("deprecate v1, register v2, findActive returns only v2", async () => {
    companyId = await seedCompany("dep");

    const v1 = await registry.register({
      companyId,
      kind: "api",
      name: "inventory-api",
      version: "v1",
    });

    await registry.register({
      companyId,
      kind: "api",
      name: "inventory-api",
      version: "v2",
    });

    await registry.deprecate(v1.id, "inventory-api@v2");

    const active = await registry.findActive("api", "inventory-api");
    expect(active.length).toBe(1);
    expect(active[0].version).toBe("v2");
    expect(active[0].deprecatedAt).toBeNull();
  });

  it("deprecate throws for unknown id", async () => {
    companyId = await seedCompany("err");
    await expect(registry.deprecate(randomUUID(), "replacement")).rejects.toThrow();
  });

  it("findActive returns empty array when all versions deprecated", async () => {
    companyId = await seedCompany("empty");

    const v1 = await registry.register({
      companyId,
      kind: "schema",
      name: "user-schema",
      version: "1",
    });

    await registry.deprecate(v1.id, "user-schema@v2");

    const active = await registry.findActive("schema", "user-schema");
    expect(active.length).toBe(0);
  });
});
