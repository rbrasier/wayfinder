import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { core_users } from "./core";

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

export const ai_usage_events = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id").references(() => core_users.id, { onDelete: "set null" }),
  conversation_id: uuid("conversation_id").references(() => ai_conversations.id, {
    onDelete: "set null",
  }),
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
});
