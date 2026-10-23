import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { core_users } from "./core";
import { app_flows } from "./wayfinder";

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

// Uploaded SKILL.md library (ADR-031). `frontmatter` keeps the raw parsed
// key/value pairs; `allowed_tools` is the normalised allowed-tools declaration
// (used in Phase 2 for MCP). Editing bumps `version`.
export const app_skills = pgTable(
  "app_skills",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    description: text("description"),
    body: text("body").notNull(),
    allowed_tools: jsonb("allowed_tools").$type<string[]>().notNull().default([]),
    frontmatter: jsonb("frontmatter").$type<Record<string, string>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    created_by_user_id: uuid("created_by_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_status: index("app_skills_status_idx").on(t.status),
  }),
);

// A flow's inbound start address (ADR-064 §3). One row per (flow, kind); `kind`
// is only `webhook` today, kept as a column so a scheduled start can join it
// without a new table. Only the token's hash is stored, and the HMAC secret is
// encrypted at rest — neither is ever returned to a client.
export const app_flow_triggers = pgTable(
  "app_flow_triggers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["webhook"] }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    token_hash: text("token_hash"),
    token_last_four: text("token_last_four"),
    hmac_secret_encrypted: text("hmac_secret_encrypted"),
    run_as_user_id: uuid("run_as_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    created_by: uuid("created_by").references(() => core_users.id, { onDelete: "set null" }),
    last_triggered_at: timestamp("last_triggered_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    flow_kind_unique: unique("app_flow_triggers_flow_id_kind_unique").on(t.flow_id, t.kind),
    token_hash_unique: unique("app_flow_triggers_token_hash_unique").on(t.token_hash),
  }),
);
