import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { missions } from "./missions.js";

export const missionReflections = pgTable(
  "mission_reflections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    missionId: uuid("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    missionCreatedIdx: index("mission_reflections_mission_created_idx").on(table.missionId, table.createdAt),
    kindIdx: index("mission_reflections_kind_idx").on(table.kind),
  }),
);
