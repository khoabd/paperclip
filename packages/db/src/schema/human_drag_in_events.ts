import { pgTable, uuid, text, jsonb, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { intakeItems } from "./intake_items.js";

export const humanDragInEvents = pgTable(
  "human_drag_in_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    minutesEstimated: numeric("minutes_estimated", { precision: 8, scale: 2 }),
    intakeId: uuid("intake_id").references(() => intakeItems.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id"),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKindIdx: index("human_drag_in_events_company_kind_idx").on(
      table.companyId,
      table.kind,
      table.occurredAt,
    ),
  }),
);
