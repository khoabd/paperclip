import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { missions } from "./missions.js";

export const intakeItems = pgTable(
  "intake_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    priority: text("priority"),
    state: text("state").notNull().default("triaged"),
    submitterUserId: text("submitter_user_id"),
    submitterMood: integer("submitter_mood"),
    rawText: text("raw_text").notNull(),
    title: text("title"),
    attachments: jsonb("attachments").notNull().default([]),
    classifiedTypeConf: numeric("classified_type_conf", { precision: 5, scale: 4 }),
    linkedReleaseTag: text("linked_release_tag"),
    linkedFeatureKey: text("linked_feature_key"),
    duplicateOf: uuid("duplicate_of"),
    missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
    source: text("source").notNull().default("human_console"),
    sourceRef: text("source_ref"),
    spec: text("spec"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => ({
    companyStateIdx: index("intake_items_company_state_idx")
      .on(table.companyId, table.state)
      .where(sql`${table.closedAt} IS NULL`),
    companyTypeCreatedIdx: index("intake_items_company_type_created_idx").on(
      table.companyId,
      table.type,
      table.createdAt,
    ),
    missionIdx: index("intake_items_mission_idx")
      .on(table.missionId)
      .where(sql`${table.missionId} IS NOT NULL`),
  }),
);
