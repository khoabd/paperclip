import { pgTable, uuid, text, integer, numeric, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const llmQuotaState = pgTable(
  "llm_quota_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    costUsedUsd: numeric("cost_used_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    calls: integer("calls").notNull().default(0),
    status: text("status").notNull().default("within"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyWeekUq: uniqueIndex("llm_quota_state_company_week_uq").on(table.companyId, table.weekStart),
  }),
);
