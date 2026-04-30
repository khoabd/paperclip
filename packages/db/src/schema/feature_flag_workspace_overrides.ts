import { pgTable, uuid, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { featureFlags } from "./feature_flags.js";
import { companies } from "./companies.js";

export const featureFlagWorkspaceOverrides = pgTable(
  "feature_flag_workspace_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => featureFlags.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    value: boolean("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    flagCompanyIdx: uniqueIndex("feature_flag_workspace_overrides_flag_company_idx").on(
      table.flagId,
      table.companyId,
    ),
  }),
);
