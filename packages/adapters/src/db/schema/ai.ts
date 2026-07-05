import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { core_users } from "./core";
import { app_flows } from "./wayfinder";

export const ai_conversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id").references(() => core_users.id, { onDelete: "set null" }),
  title: text("title"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ai_messages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  conversation_id: uuid("conversation_id")
    .notNull()
    .references(() => ai_conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ai_usage_events = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").references(() => core_users.id, { onDelete: "set null" }),
    conversation_id: uuid("conversation_id"),
    // Flow + session attribution for the governance dashboard (ADR-026). Both
    // nullable: ad-hoc calls with no flow/session record nulls here.
    flow_id: uuid("flow_id").references(() => app_flows.id, { onDelete: "set null" }),
    session_id: uuid("session_id"),
    purpose: text("purpose").notNull().default(""),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    system_tokens: integer("system_tokens").notNull().default(0),
    cache_read_tokens: integer("cache_read_tokens").notNull().default(0),
    cache_write_tokens: integer("cache_write_tokens").notNull().default(0),
    cost_usd: real("cost_usd").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Backs per-user period-spend sums on the enforcement hot path (ADR-026 §5).
    by_user_created: index("ai_usage_events_user_id_created_at_idx").on(t.user_id, t.created_at),
    by_flow_created: index("ai_usage_events_flow_id_created_at_idx").on(t.flow_id, t.created_at),
    by_session: index("ai_usage_events_session_id_idx").on(t.session_id),
    // Backs the retention sweep's oldest-first range scan (scaling wall #9).
    by_created: index("ai_usage_events_created_at_idx").on(t.created_at),
  }),
);
