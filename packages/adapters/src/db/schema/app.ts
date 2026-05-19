import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { core_users } from "./core";

export const app_error_log = pgTable(
  "app_error_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    level: text("level", {
      enum: ["debug", "info", "warn", "error", "fatal"],
    })
      .notNull()
      .default("error"),
    message: text("message").notNull(),
    stack: text("stack"),
    user_id: uuid("user_id").references(() => core_users.id, { onDelete: "set null" }),
    page: text("page"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    status: text("status", { enum: ["active", "dismissed", "resolved"] })
      .notNull()
      .default("active"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_status: index("app_error_log_status_idx").on(t.status),
    by_message_page: index("app_error_log_msg_page_idx").on(t.message, t.page),
  }),
);
