// Persistence helpers for rejection_events.
// Per Phase-10 spec §10.2.
//
// NOTE: rejection_events is not yet in the Drizzle schema registry (pending
// orchestrator merge of schema/index.ts). All DML uses db.execute(sql`...`)
// or Drizzle ORM with ISO string conversions to avoid binary-mode type issues.

import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { rejectionEvents } from "@paperclipai/db/schema/rejection_events";

// 14-category taxonomy per Phase-10 spec and Rejection-Learning §2
export type RejectionCategory =
  | "wrong_scope"
  | "missing_context"
  | "spec_violation"
  | "design_conflict"
  | "tech_debt"
  | "security"
  | "performance"
  | "accessibility"
  | "i18n"
  | "test_gap"
  | "docs_gap"
  | "cost"
  | "timeline"
  | "other";

export interface RecordRejectionInput {
  companyId: string;
  approvalId?: string | null;
  missionId?: string | null;
  intakeId?: string | null;
  category: RejectionCategory;
  subCategory?: string | null;
  reason?: string | null;
  severity?: number | null;
  embeddingId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface ListByCompanyOpts {
  category?: RejectionCategory;
  limit?: number;
  sinceDate?: Date;
}

type RawEventRow = {
  id: string;
  company_id: string;
  approval_id: string | null;
  mission_id: string | null;
  intake_id: string | null;
  category: string;
  sub_category: string | null;
  reason: string | null;
  severity: number | null;
  embedding_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export class RejectionStore {
  constructor(private readonly db: Db) {}

  async record(input: RecordRejectionInput): Promise<string> {
    const occurredIso = (input.occurredAt ?? new Date()).toISOString();
    const payloadJson = JSON.stringify(input.payload ?? {});

    const result = await this.db.execute<{ id: string }>(sql`
      INSERT INTO rejection_events
        (company_id, approval_id, mission_id, intake_id, category, sub_category,
         reason, severity, embedding_id, payload, occurred_at)
      VALUES
        (${input.companyId},
         ${input.approvalId ?? null},
         ${input.missionId ?? null},
         ${input.intakeId ?? null},
         ${input.category},
         ${input.subCategory ?? null},
         ${input.reason ?? null},
         ${input.severity ?? null},
         ${input.embeddingId ?? null},
         ${payloadJson}::jsonb,
         ${occurredIso}::timestamptz)
      RETURNING id
    `);

    return Array.from(result)[0]!.id;
  }

  async listByCompany(
    companyId: string,
    opts: ListByCompanyOpts = {},
  ) {
    const limit = opts.limit ?? 100;
    let whereClause = sql`company_id = ${companyId}`;

    if (opts.category) {
      whereClause = sql`${whereClause} AND category = ${opts.category}`;
    }
    if (opts.sinceDate) {
      whereClause = sql`${whereClause} AND occurred_at >= ${opts.sinceDate.toISOString()}::timestamptz`;
    }

    const rows = await this.db.execute<RawEventRow>(sql`
      SELECT * FROM rejection_events
      WHERE ${whereClause}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `);

    return Array.from(rows);
  }

  async recentByCategory(
    companyId: string,
    category: RejectionCategory,
    days: number,
  ) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.listByCompany(companyId, { category, sinceDate: since });
  }

  async listWithEmbeddings(
    companyId: string,
    days: number,
  ) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    const rows = await this.db.execute<RawEventRow>(sql`
      SELECT * FROM rejection_events
      WHERE company_id = ${companyId}
        AND occurred_at >= ${sinceIso}::timestamptz
        AND embedding_id IS NOT NULL
      ORDER BY occurred_at DESC
    `);

    return Array.from(rows);
  }
}
