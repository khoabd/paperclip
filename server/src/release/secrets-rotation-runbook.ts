// SecretsRotationRunbook — Phase 15 §Services.4
//
// Audit trail and rotation-due query service for secrets management.
// Does NOT store secret material — only records events and expiry metadata.

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { secretsRotationAudit } from "@paperclipai/db/schema/secrets_rotation_audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecretKind = "api_key" | "oauth_token" | "webhook_secret" | "encryption_key";
export type SecretAction = "rotated" | "expired" | "revoked" | "emergency_revoke";

export interface RecordRotationInput {
  companyId: string;
  secretName: string;
  kind: SecretKind | string;
  action: SecretAction | string;
  rotatedByUserId?: string;
  expiresAt?: Date;
  succeeded?: boolean;
  error?: string;
}

export interface RotationAuditRow {
  id: string;
  companyId: string;
  secretName: string;
  kind: string;
  action: string;
  rotatedByUserId: string | null;
  expiresAt: Date | null;
  succeeded: boolean;
  error: string | null;
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// SecretsRotationRunbook
// ---------------------------------------------------------------------------

export class SecretsRotationRunbook {
  constructor(private readonly db: Db) {}

  /** Record a rotation/expiry/revoke event for a secret. */
  async recordRotation(input: RecordRotationInput): Promise<RotationAuditRow> {
    const [row] = await this.db
      .insert(secretsRotationAudit)
      .values({
        companyId: input.companyId,
        secretName: input.secretName,
        kind: input.kind,
        action: input.action,
        rotatedByUserId: input.rotatedByUserId ?? null,
        expiresAt: input.expiresAt ?? null,
        succeeded: input.succeeded ?? true,
        error: input.error ?? null,
      })
      .returning();

    return this.toRow(row);
  }

  /**
   * Return secrets that are expiring within `withinDays` days from now.
   * Returns the most recent audit row per secret_name (the latest expiry record).
   */
  async findExpiringSoon(
    companyId: string,
    withinDays: number,
  ): Promise<RotationAuditRow[]> {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    // Get all rows with a non-null expires_at that falls within the window
    const rows = await this.db
      .select()
      .from(secretsRotationAudit)
      .where(
        and(
          eq(secretsRotationAudit.companyId, companyId),
          lte(secretsRotationAudit.expiresAt, cutoff),
          gte(secretsRotationAudit.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(secretsRotationAudit.expiresAt));

    // Deduplicate: return the earliest-expiring record per secret_name
    const seen = new Set<string>();
    const unique: RotationAuditRow[] = [];
    for (const row of rows) {
      if (!seen.has(row.secretName)) {
        seen.add(row.secretName);
        unique.push(this.toRow(row));
      }
    }
    return unique;
  }

  /**
   * Return all audit rows for a specific secret over the past `lookbackDays` days,
   * most recent first.
   */
  async auditTrail(
    companyId: string,
    secretName: string,
    lookbackDays: number,
  ): Promise<RotationAuditRow[]> {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .select()
      .from(secretsRotationAudit)
      .where(
        and(
          eq(secretsRotationAudit.companyId, companyId),
          eq(secretsRotationAudit.secretName, secretName),
          gte(secretsRotationAudit.occurredAt, since),
        ),
      )
      .orderBy(desc(secretsRotationAudit.occurredAt));

    return rows.map((r) => this.toRow(r));
  }

  private toRow(row: typeof secretsRotationAudit.$inferSelect): RotationAuditRow {
    return {
      id: row.id,
      companyId: row.companyId,
      secretName: row.secretName,
      kind: row.kind,
      action: row.action,
      rotatedByUserId: row.rotatedByUserId ?? null,
      expiresAt: row.expiresAt ?? null,
      succeeded: row.succeeded,
      error: row.error ?? null,
      occurredAt: row.occurredAt,
    };
  }
}
