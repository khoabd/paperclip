import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { platformSkills } from "./platform_skills.js";

export const workspaceSkillPins = pgTable(
  "workspace_skill_pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => platformSkills.id, { onDelete: "cascade" }),
    pinnedVersion: text("pinned_version").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySkillUq: uniqueIndex("workspace_skill_pins_company_skill_uq").on(
      table.companyId,
      table.skillId,
    ),
  }),
);
