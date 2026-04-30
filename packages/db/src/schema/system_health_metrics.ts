import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const systemHealthMetrics = pgTable(
  "system_health_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** workspace | service | mission | global */
    scope: text("scope").notNull(),
    scopeId: text("scope_id"),
    /** latency_p50 | latency_p95 | error_rate | cost_per_hour | gate_compliance |
     *  trust_promotion_rate | drag_in_rate | brier | stuck_event_rate */
    kind: text("kind").notNull(),
    value: numeric("value", { precision: 12, scale: 4 }),
    threshold: numeric("threshold", { precision: 12, scale: 4 }),
    /** green | yellow | red */
    status: text("status").notNull().default("green"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKindRecordedIdx: index("shm_company_scope_kind_recorded_idx").on(
      table.companyId,
      table.scope,
      table.kind,
      table.recordedAt,
    ),
  }),
);
