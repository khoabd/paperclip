import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { kbRepositories } from "./kb_repositories.js";

export const magikaInventory = pgTable(
  "magika_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => kbRepositories.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    magikaLabel: text("magika_label").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    isVendored: boolean("is_vendored").notNull().default(false),
    isGenerated: boolean("is_generated").notNull().default(false),
    isBinary: boolean("is_binary").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    repoPathUnique: unique("magika_inventory_repo_path_unique").on(
      table.repoId,
      table.filePath,
    ),
    repoLabelIdx: index("magika_inventory_repo_label_idx").on(
      table.repoId,
      table.magikaLabel,
    ),
  }),
);
