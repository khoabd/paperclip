import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { kbRepositories } from "./kb_repositories.js";

export const kbCoverageGaps = pgTable("kb_coverage_gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => kbRepositories.id, { onDelete: "cascade" }),
  kind: text("kind"),
  targetPath: text("target_path"),
  severity: integer("severity"),
  suggestedAction: text("suggested_action"),
  status: text("status").notNull().default("open"),
  detectedAt: timestamp("detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
