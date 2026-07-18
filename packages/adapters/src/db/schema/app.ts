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
    // Backs the retention sweep's oldest-first range scan (scaling wall #9).
    by_created: index("app_error_log_created_at_idx").on(t.created_at),
  }),
);

// Legal hold (ADR-033). A named freeze that overrides retention. `scope` is a
// coarse JSON discriminated union — `{ kind: "global" }` or
// `{ kind: "by_session", sessionId }` — kept as jsonb so scope granularity can
// grow without a migration. An active hold is one whose `released_at` is null.
export const app_legal_holds = pgTable(
  "app_legal_holds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    reason: text("reason"),
    created_by: uuid("created_by").references(() => core_users.id, { onDelete: "set null" }),
    scope: jsonb("scope").$type<{ kind: "global" } | { kind: "by_session"; sessionId: string }>().notNull(),
    released_at: timestamp("released_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The retention guard reads active holds on every sweep.
    by_released: index("app_legal_holds_released_at_idx").on(t.released_at),
  }),
);
