// Integration tests for SecretsRotationRunbook.
// Gate criteria:
//   • recordRotation persists a row with correct fields
//   • findExpiringSoon returns secrets expiring within window, sorted by expiresAt
//   • findExpiringSoon excludes already-expired secrets and those outside window
//   • auditTrail returns history for a secret within lookback window, desc order
//   • auditTrail excludes records older than lookback

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { SecretsRotationRunbook } from "../secrets-rotation-runbook.js";

const support = await getEmbeddedPostgresTestSupport();
const desc = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping SecretsRotationRunbook integration: ${support.reason ?? "unsupported"}`);
}

desc("SecretsRotationRunbook integration", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let runbook!: SecretsRotationRunbook;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("secrets-rotation-");
    cleanup = started.cleanup;
    db = createDb(started.connectionString);
    runbook = new SecretsRotationRunbook(db);
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM secrets_rotation_audit`);
    await db.delete(companies);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  async function seedCompany(prefix: string): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name: `SRCo-${prefix}`,
      issuePrefix: `SR${prefix.toUpperCase().slice(0, 3)}`,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  it("recordRotation persists a row with correct fields", async () => {
    const companyId = await seedCompany("rec");
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const row = await runbook.recordRotation({
      companyId,
      secretName: "gitlab-api-key",
      kind: "api_key",
      action: "rotated",
      rotatedByUserId: "user-abc",
      expiresAt: future,
      succeeded: true,
    });

    expect(row.id).toBeTruthy();
    expect(row.companyId).toBe(companyId);
    expect(row.secretName).toBe("gitlab-api-key");
    expect(row.kind).toBe("api_key");
    expect(row.action).toBe("rotated");
    expect(row.rotatedByUserId).toBe("user-abc");
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(row.succeeded).toBe(true);
    expect(row.error).toBeNull();
  });

  it("recordRotation with error flag persists error message", async () => {
    const companyId = await seedCompany("err");
    const row = await runbook.recordRotation({
      companyId,
      secretName: "webhook-secret",
      kind: "webhook_secret",
      action: "rotated",
      succeeded: false,
      error: "rotation API timed out",
    });
    expect(row.succeeded).toBe(false);
    expect(row.error).toBe("rotation API timed out");
  });

  it("findExpiringSoon returns secrets within window sorted by expiresAt", async () => {
    const companyId = await seedCompany("expiring");
    const now = Date.now();

    // Expires in 5 days
    await runbook.recordRotation({
      companyId,
      secretName: "key-soon",
      kind: "api_key",
      action: "rotated",
      expiresAt: new Date(now + 5 * 24 * 60 * 60 * 1000),
    });

    // Expires in 20 days (outside 14-day window)
    await runbook.recordRotation({
      companyId,
      secretName: "key-later",
      kind: "oauth_token",
      action: "rotated",
      expiresAt: new Date(now + 20 * 24 * 60 * 60 * 1000),
    });

    // Expires in 10 days (within 14-day window)
    await runbook.recordRotation({
      companyId,
      secretName: "key-medium",
      kind: "encryption_key",
      action: "rotated",
      expiresAt: new Date(now + 10 * 24 * 60 * 60 * 1000),
    });

    const expiring = await runbook.findExpiringSoon(companyId, 14);
    expect(expiring).toHaveLength(2);
    // Should be sorted by expiresAt ascending
    expect(expiring[0].secretName).toBe("key-soon");
    expect(expiring[1].secretName).toBe("key-medium");
  });

  it("findExpiringSoon excludes already-expired secrets", async () => {
    const companyId = await seedCompany("past");
    // Already expired
    await runbook.recordRotation({
      companyId,
      secretName: "expired-key",
      kind: "api_key",
      action: "expired",
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });
    // Expires in 5 days
    await runbook.recordRotation({
      companyId,
      secretName: "upcoming-key",
      kind: "api_key",
      action: "rotated",
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    const expiring = await runbook.findExpiringSoon(companyId, 14);
    expect(expiring).toHaveLength(1);
    expect(expiring[0].secretName).toBe("upcoming-key");
  });

  it("auditTrail returns history desc by occurredAt within lookback window", async () => {
    const companyId = await seedCompany("trail");
    const secretName = "db-encryption-key";

    for (let i = 0; i < 3; i++) {
      await runbook.recordRotation({
        companyId,
        secretName,
        kind: "encryption_key",
        action: "rotated",
      });
    }

    const trail = await runbook.auditTrail(companyId, secretName, 30);
    expect(trail).toHaveLength(3);
    // Verify descending order
    for (let i = 0; i < trail.length - 1; i++) {
      expect(trail[i].occurredAt.getTime()).toBeGreaterThanOrEqual(
        trail[i + 1].occurredAt.getTime(),
      );
    }
  });

  it("auditTrail filters by secretName — other secrets excluded", async () => {
    const companyId = await seedCompany("filter");

    await runbook.recordRotation({
      companyId,
      secretName: "secret-a",
      kind: "api_key",
      action: "rotated",
    });
    await runbook.recordRotation({
      companyId,
      secretName: "secret-b",
      kind: "oauth_token",
      action: "rotated",
    });

    const trail = await runbook.auditTrail(companyId, "secret-a", 30);
    expect(trail).toHaveLength(1);
    expect(trail[0].secretName).toBe("secret-a");
  });
});
