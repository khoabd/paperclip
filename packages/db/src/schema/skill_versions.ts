import { pgTable, uuid, text, jsonb, numeric, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { platformSkills } from "./platform_skills.js";

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => platformSkills.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    codePath: text("code_path").notNull(),
    inputSchema: jsonb("input_schema").notNull().default({}),
    outputSchema: jsonb("output_schema").notNull().default({}),
    status: text("status").notNull().default("canary"),
    costP50Usd: numeric("cost_p50_usd", { precision: 10, scale: 4 }),
    brier30d: numeric("brier_30d", { precision: 5, scale: 4 }),
    rejectionRate7d: numeric("rejection_rate_7d", { precision: 5, scale: 4 }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skillVersionUq: uniqueIndex("skill_versions_skill_version_uq").on(table.skillId, table.version),
    statusIdx: index("skill_versions_status_idx").on(table.skillId, table.status),
  }),
);
