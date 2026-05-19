import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { FlowContextDoc, FlowPermission } from "@rbrasier/domain";
import type { SessionDocument } from "@rbrasier/domain";
import { core_users } from "./core";

export const app_flows = pgTable(
  "app_flows",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    owner_user_id: uuid("owner_user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    permissions: jsonb("permissions").$type<FlowPermission[]>().notNull().default([]),
    context_docs: jsonb("context_docs").$type<FlowContextDoc[]>().notNull().default([]),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const app_flow_nodes = pgTable(
  "app_flow_nodes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["conversational", "auto"] }).notNull().default("conversational"),
    name: text("name").notNull(),
    colour: text("colour"),
    position_x: integer("position_x").notNull().default(0),
    position_y: integer("position_y").notNull().default(0),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_flow_nodes_flow_id_idx").on(t.flow_id),
  }),
);

export const app_flow_edges = pgTable(
  "app_flow_edges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    from_node_id: uuid("from_node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    to_node_id: uuid("to_node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_flow_edges_flow_id_idx").on(t.flow_id),
    by_from_node: index("app_flow_edges_from_node_id_idx").on(t.from_node_id),
  }),
);

export const app_sessions = pgTable(
  "app_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "restrict" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "complete", "abandoned"] })
      .notNull()
      .default("active"),
    title: text("title"),
    current_node_id: uuid("current_node_id"),
    graph_checkpoint: jsonb("graph_checkpoint").$type<Record<string, unknown>>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_user: index("app_sessions_user_id_created_at_idx").on(t.user_id, t.created_at),
    by_flow: index("app_sessions_flow_id_idx").on(t.flow_id),
  }),
);

export const app_session_messages = pgTable(
  "app_session_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    confidence: smallint("confidence"),
    step_node_id: uuid("step_node_id"),
    document: jsonb("document").$type<SessionDocument>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_session: index("app_session_messages_session_id_created_at_idx").on(
      t.session_id,
      t.created_at,
    ),
  }),
);
