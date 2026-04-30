import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const syntheticProbeResults = pgTable(
  "synthetic_probe_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    probeName: text("probe_name").notNull(),
    /** dev | stag | live */
    env: text("env").notNull(),
    /** passed | failed | degraded */
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    errorText: text("error_text"),
    screenshotUri: text("screenshot_uri"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyEnvOccurredIdx: index(
      "synthetic_probe_results_company_env_occurred_idx",
    ).on(table.companyId, table.env, table.occurredAt),
    probeStatusOccurredIdx: index(
      "synthetic_probe_results_probe_status_occurred_idx",
    ).on(table.probeName, table.status, table.occurredAt),
  }),
);
