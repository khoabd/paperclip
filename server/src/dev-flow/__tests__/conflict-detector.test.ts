// Unit + integration tests for ConflictDetector.
// Per Phase-7-Development-Flow-Feature-Flags §7.4.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  conflictEvents,
  createDb,
  designDocs,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { detectConflicts, ConflictDetector } from "../conflict/conflict-detector.js";

// ─── Pure unit tests ───────────────────────────────────────────────────────

describe("detectConflicts (pure)", () => {
  it("detects schema conflict on matching CREATE TABLE", () => {
    const a = "We need to CREATE TABLE users (id uuid)";
    const b = "Proposal to CREATE TABLE users with new columns";
    const result = detectConflicts(a, b);
    const kinds = result.map((c) => c.kind);
    expect(kinds).toContain("schema");
    expect(result.find((c) => c.kind === "schema")?.detail.token).toBe("users");
  });

  it("detects api conflict on matching route signature", () => {
    const a = "We add GET /api/payments endpoint";
    const b = "Route GET /api/payments returns 404 if no payment";
    const result = detectConflicts(a, b);
    const kinds = result.map((c) => c.kind);
    expect(kinds).toContain("api");
  });

  it("detects ui conflict on matching component: token", () => {
    const a = "component: CheckoutFlow needs dark mode support";
    const b = "Refactor component: CheckoutFlow for mobile";
    const result = detectConflicts(a, b);
    const kinds = result.map((c) => c.kind);
    expect(kinds).toContain("ui");
    expect(result.find((c) => c.kind === "ui")?.detail.token).toBe("checkoutflow");
  });

  it("detects behavior conflict on matching feature_key: token", () => {
    const a = "feature_key: dark_mode will be enabled for beta users";
    const b = "We need to remove feature_key: dark_mode from the system";
    const result = detectConflicts(a, b);
    const kinds = result.map((c) => c.kind);
    expect(kinds).toContain("behavior");
  });

  it("returns empty array for unrelated docs", () => {
    const a = "This is about the invoice PDF generator. CREATE TABLE invoices (id uuid)";
    const b = "This is about the user notification bell. component: NotificationBell";
    const result = detectConflicts(a, b);
    // They share nothing — no conflicts.
    expect(result).toHaveLength(0);
  });

  it("no false positive on different tables", () => {
    const a = "CREATE TABLE orders (id uuid)";
    const b = "CREATE TABLE payments (id uuid)";
    const result = detectConflicts(a, b);
    expect(result.filter((c) => c.kind === "schema")).toHaveLength(0);
  });

  it("no false positive on different routes", () => {
    const a = "GET /api/orders";
    const b = "POST /api/payments";
    const result = detectConflicts(a, b);
    expect(result.filter((c) => c.kind === "api")).toHaveLength(0);
  });

  it("detects ALTER TABLE column-add conflict", () => {
    const a = "ALTER TABLE payments ADD COLUMN stripe_id text";
    const b = "ALTER TABLE payments ADD COLUMN paypal_id text";
    const result = detectConflicts(a, b);
    const schemaConflicts = result.filter((c) => c.kind === "schema");
    expect(schemaConflicts.length).toBeGreaterThan(0);
  });
});

// ─── Integration tests ─────────────────────────────────────────────────────

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping ConflictDetector integration tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`,
  );
}

describeEmbeddedPostgres("ConflictDetector (integration)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let detector!: ConflictDetector;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("conflict-detector-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    detector = new ConflictDetector(db);
  });

  afterEach(async () => {
    await db.delete(conflictEvents);
    await db.delete(designDocs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  let prefixCounter = 0;

  async function seedWorkspace(): Promise<string> {
    const id = randomUUID();
    prefixCounter++;
    await db.insert(companies).values({
      id,
      name: `ConflictCo${prefixCounter}`,
      status: "active",
      autonomyLevel: "sandbox",
      wfqWeight: 100,
      costBudgetUsdPerWeek: "100.0000",
      issuePrefix: `CF${prefixCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function seedDoc(
    companyId: string,
    key: string,
    body: string,
    status = "review",
  ): Promise<string> {
    const [doc] = await db
      .insert(designDocs)
      .values({ companyId, key, title: key, body, status })
      .returning({ id: designDocs.id });
    if (!doc) throw new Error("insert failed");
    return doc.id;
  }

  it("writes a conflict_events row when two docs share a component: token (ui)", async () => {
    const wsId = await seedWorkspace();
    const docAId = await seedDoc(wsId, "doc-a", "component: CheckoutFlow needs dark mode");
    await seedDoc(wsId, "doc-b", "Refactor component: CheckoutFlow for mobile");

    const count = await detector.runOnDesignDoc(docAId);
    expect(count).toBeGreaterThan(0);

    const rows = await db.select().from(conflictEvents);
    const uiConflict = rows.find((r) => r.kind === "ui");
    expect(uiConflict).toBeDefined();
    expect(uiConflict?.designDocAId).toBe(docAId);
  });

  it("writes a conflict_events row for schema conflict", async () => {
    const wsId = await seedWorkspace();
    const docAId = await seedDoc(wsId, "doc-schema-a", "CREATE TABLE orders (id uuid)");
    await seedDoc(wsId, "doc-schema-b", "CREATE TABLE orders with new payment_method column");

    const count = await detector.runOnDesignDoc(docAId);
    expect(count).toBeGreaterThan(0);

    const rows = await db.select().from(conflictEvents);
    const schemaConflict = rows.find((r) => r.kind === "schema");
    expect(schemaConflict).toBeDefined();
  });

  it("writes no conflict_events row for unrelated docs", async () => {
    const wsId = await seedWorkspace();
    const docAId = await seedDoc(wsId, "doc-unrelated-a", "CREATE TABLE invoices (id uuid)");
    await seedDoc(wsId, "doc-unrelated-b", "component: NotificationBell redesign");

    const count = await detector.runOnDesignDoc(docAId);
    expect(count).toBe(0);
  });

  it("skips archived docs during comparison", async () => {
    const wsId = await seedWorkspace();
    const docAId = await seedDoc(wsId, "doc-active", "component: Sidebar layout");
    await seedDoc(wsId, "doc-archived", "component: Sidebar old design", "archived");

    const count = await detector.runOnDesignDoc(docAId);
    expect(count).toBe(0);
  });
});
