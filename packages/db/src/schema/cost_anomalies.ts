import { pgTable, uuid, text, jsonb, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const costAnomalies = pgTable(
  "cost_anomalies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    thresholdUsd: numeric("threshold_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    actualUsd: numeric("actual_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    ratio: numeric("ratio", { precision: 8, scale: 4 }),
    details: jsonb("details").notNull().default({}),
    status: text("status").notNull().default("open"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    companyStatusIdx: index("cost_anomalies_company_status_idx").on(table.companyId, table.status),
    occurredIdx: index("cost_anomalies_occurred_idx").on(table.occurredAt),
  }),
);
