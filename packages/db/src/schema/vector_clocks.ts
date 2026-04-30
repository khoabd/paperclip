import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const vectorClocks = pgTable(
  "vector_clocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    /** Map of node → logical clock counter, e.g. {"agent.architect": 47, "rag.index_1": 9} */
    clock: jsonb("clock").$type<Record<string, number>>().notNull().default({}),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyScopeScopeIdUnique: unique("vector_clocks_company_scope_scope_id_unique").on(
      table.companyId,
      table.scope,
      table.scopeId,
    ),
  }),
);
