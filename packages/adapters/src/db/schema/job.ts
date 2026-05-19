import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const job_registry = pgTable("job_registry", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  status: text("status", { enum: ["healthy", "degraded", "failed", "unknown"] })
    .notNull()
    .default("unknown"),
  last_run_at: timestamp("last_run_at", { withTimezone: true }),
  next_run_at: timestamp("next_run_at", { withTimezone: true }),
  error_count: integer("error_count").notNull().default(0),
  last_error: text("last_error"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
