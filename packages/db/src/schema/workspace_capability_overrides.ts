import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { capabilityRegistry } from "./capability_registry.js";

export const workspaceCapabilityOverrides = pgTable(
  "workspace_capability_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capabilityRegistry.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    overrideReason: text("override_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCapUq: uniqueIndex("workspace_capability_overrides_company_cap_uq").on(
      table.companyId,
      table.capabilityId,
    ),
    companyIdx: index("workspace_capability_overrides_company_idx").on(table.companyId),
  }),
);
