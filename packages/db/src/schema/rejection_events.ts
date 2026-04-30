import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";
import { missions } from "./missions.js";
import { intakeItems } from "./intake_items.js";
import { entityEmbeddings } from "./entity_embeddings.js";

export const REJECTION_CATEGORIES = [
  "wrong_scope",
  "missing_context",
  "spec_violation",
  "design_conflict",
  "tech_debt",
  "security",
  "performance",
  "accessibility",
  "i18n",
  "test_gap",
  "docs_gap",
  "cost",
  "timeline",
  "other",
] as const;

export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];

export const rejectionEvents = pgTable(
  "rejection_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").references(() => approvals.id, {
      onDelete: "set null",
    }),
    missionId: uuid("mission_id").references(() => missions.id, {
      onDelete: "set null",
    }),
    intakeId: uuid("intake_id").references(() => intakeItems.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    subCategory: text("sub_category"),
    reason: text("reason"),
    severity: integer("severity"),
    embeddingId: uuid("embedding_id").references(() => entityEmbeddings.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyCategoryOccurredIdx: index(
      "rejection_events_company_category_occurred_idx",
    ).on(table.companyId, table.category, table.occurredAt),
    approvalIdx: index("rejection_events_approval_idx").on(table.approvalId),
  }),
);
