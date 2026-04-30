import { pgTable, uuid, text, numeric, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const decisionClassLookup = pgTable(
  "decision_class_lookup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. generic | code_change | external_action | policy_exception | cost_burst | data_export | deploy | migration */
    kind: text("kind").notNull(),
    /** easy | hard | irreversible */
    reversibility: text("reversibility").notNull(),
    /** local | workspace | company | global */
    blastRadius: text("blast_radius").notNull(),
    /** Base confidence threshold (0–1). Gate fires when agent confidence < threshold. */
    defaultThreshold: numeric("default_threshold", { precision: 5, scale: 4 }).notNull(),
    defaultPattern: text("default_pattern"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindRevBlastUidx: uniqueIndex("decision_class_lookup_kind_rev_blast_uidx").on(
      table.kind,
      table.reversibility,
      table.blastRadius,
    ),
    kindIdx: index("decision_class_lookup_kind_idx").on(table.kind),
  }),
);
