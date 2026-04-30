import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const secretsRotationAudit = pgTable(
  "secrets_rotation_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    secretName: text("secret_name").notNull(),
    /** api_key | oauth_token | webhook_secret | encryption_key */
    kind: text("kind").notNull(),
    /** rotated | expired | revoked | emergency_revoke */
    action: text("action").notNull(),
    rotatedByUserId: text("rotated_by_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    succeeded: boolean("succeeded").notNull().default(true),
    error: text("error"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySecretOccurredIdx: index("sra_company_secret_occurred_idx").on(
      table.companyId,
      table.secretName,
      table.occurredAt,
    ),
  }),
);
