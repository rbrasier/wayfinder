import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { FlowPermission, FlowVisibility } from "@rbrasier/domain";
import type { AiTurnPayload, SessionDocument, StepOutputField } from "@rbrasier/domain";
import { core_users } from "./core";

type StoredContextDoc = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export const app_flows = pgTable(
  "app_flows",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    expert_role: text("expert_role"),
    owner_user_id: uuid("owner_user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    visibility: jsonb("visibility")
      .$type<FlowVisibility>()
      .notNull()
      .default({ kind: "private" }),
    permissions: jsonb("permissions").$type<FlowPermission[]>().notNull().default([]),
    context_docs: jsonb("context_docs").$type<StoredContextDoc[]>().notNull().default([]),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
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
    sender_user_id: uuid("sender_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    confidence: smallint("confidence"),
    step_node_id: uuid("step_node_id"),
    document: jsonb("document").$type<SessionDocument>(),
    document_status: text("document_status", { enum: ["pending", "complete", "failed"] }),
    ai_payload: jsonb("ai_payload").$type<AiTurnPayload>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_session: index("app_session_messages_session_id_created_at_idx").on(
      t.session_id,
      t.created_at,
    ),
  }),
);

export const app_session_typing = pgTable(
  "app_session_typing",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "cascade" }),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    session_user_unique: unique("app_session_typing_session_id_user_id_unique").on(
      t.session_id,
      t.user_id,
    ),
    by_session_expires: index("app_session_typing_session_id_expires_at_idx").on(
      t.session_id,
      t.expires_at,
    ),
    by_user_expires: index("app_session_typing_user_id_expires_at_idx").on(
      t.user_id,
      t.expires_at,
    ),
  }),
);

export const app_session_step_outputs = pgTable(
  "app_session_step_outputs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    message_id: uuid("message_id").references(() => app_session_messages.id, {
      onDelete: "set null",
    }),
    fields: jsonb("fields").$type<StepOutputField[]>().notNull().default([]),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_session_step_outputs_flow_id_idx").on(t.flow_id),
    by_session: index("app_session_step_outputs_session_id_idx").on(t.session_id),
    by_node: index("app_session_step_outputs_node_id_idx").on(t.node_id),
  }),
);

export const admin_system_settings = pgTable(
  "admin_system_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    key: text("key").notNull(),
    value: text("value").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    key_unique: unique("admin_system_settings_key_unique").on(t.key),
  }),
);

export const kb_context_doc_content = pgTable(
  "kb_context_doc_content",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    storage_path: text("storage_path").notNull(),
    extracted_text: text("extracted_text"),
    extraction_status: text("extraction_status", {
      enum: ["pending", "complete", "failed", "unsupported"],
    }).notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    storage_path_unique: unique("kb_context_doc_content_storage_path_unique").on(t.storage_path),
    by_flow: index("kb_context_doc_content_flow_id_idx").on(t.flow_id),
  }),
);
