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
import type { HrColumnMapping } from "@rbrasier/domain";
import { core_users } from "./core";

export const admin_roles = pgTable("admin_roles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  is_system: boolean("is_system").notNull().default(false),
  is_immutable: boolean("is_immutable").notNull().default(false),
  is_default: boolean("is_default").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const admin_role_permissions = pgTable(
  "admin_role_permissions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    role_id: uuid("role_id")
      .notNull()
      .references(() => admin_roles.id, { onDelete: "cascade" }),
    permission_key: text("permission_key").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    role_permission_unique: unique("admin_role_permissions_role_id_permission_key_unique").on(
      t.role_id,
      t.permission_key,
    ),
  }),
);

export const admin_user_roles = pgTable(
  "admin_user_roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "cascade" }),
    role_id: uuid("role_id")
      .notNull()
      .references(() => admin_roles.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    user_role_unique: unique("admin_user_roles_user_id_role_id_unique").on(t.user_id, t.role_id),
  }),
);

// Flat groups (ADR-036): a sharing/delegation boundary, not tenant isolation.
// Members see the group's flows; delegated admins additionally manage membership
// and publish flows to the group — all scoped, never a global tier.
export const admin_groups = pgTable("admin_groups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const admin_group_members = pgTable(
  "admin_group_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    group_id: uuid("group_id")
      .notNull()
      .references(() => admin_groups.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "cascade" }),
    role_in_group: text("role_in_group", { enum: ["member", "delegated_admin"] })
      .notNull()
      .default("member"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    group_member_unique: unique("admin_group_members_group_id_user_id_unique").on(
      t.group_id,
      t.user_id,
    ),
    by_user: index("admin_group_members_user_id_idx").on(t.user_id),
  }),
);

// Uploaded HR spreadsheet metadata. Rows are stored in admin_hr_rows in the
// structure they arrived in; `column_mapping` records which header carries which
// canonical field for resolution (ADR-018).
export const admin_hr_datasets = pgTable("admin_hr_datasets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  source_format: text("source_format", { enum: ["csv", "xlsx"] }).notNull(),
  uploaded_by_user_id: uuid("uploaded_by_user_id")
    .notNull()
    .references(() => core_users.id, { onDelete: "restrict" }),
  columns: jsonb("columns").$type<string[]>().notNull().default([]),
  column_mapping: jsonb("column_mapping").$type<HrColumnMapping>().notNull().default({}),
  row_count: integer("row_count").notNull().default(0),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per spreadsheet row, keyed by original header, stored as-uploaded. The
// GIN index over the jsonb powers the "Someone else" search before any mapping.
export const admin_hr_rows = pgTable(
  "admin_hr_rows",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    dataset_id: uuid("dataset_id")
      .notNull()
      .references(() => admin_hr_datasets.id, { onDelete: "cascade" }),
    row_index: integer("row_index").notNull(),
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_dataset: index("admin_hr_rows_dataset_id_idx").on(t.dataset_id),
    data_gin: index("admin_hr_rows_data_gin_idx").using("gin", t.data),
  }),
);

// `flag_key` is a soft reference to `core_feature_flag.key` (ADR-022): a flag can
// be default-on without a row, so no FK — the upsert-on-scope rule keeps it sane.
export const admin_feature_flag_roles = pgTable(
  "admin_feature_flag_roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flag_key: text("flag_key").notNull(),
    role_id: uuid("role_id")
      .notNull()
      .references(() => admin_roles.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    flag_role_unique: unique("admin_feature_flag_roles_flag_key_role_id_unique").on(
      t.flag_key,
      t.role_id,
    ),
  }),
);

// Admin-registered remote MCP servers (ADR-032 §1: remote HTTP/SSE). `sse` is
// the legacy default; `streamable-http` targets the newer MCP streamable-HTTP
// endpoint. `credential_ref` points at the secret store; the secret itself is
// never stored here and never returned to a client.
export const admin_mcp_servers = pgTable("admin_mcp_servers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  transport: text("transport", { enum: ["sse", "streamable-http"] }).notNull().default("sse"),
  url: text("url").notNull(),
  credential_ref: text("credential_ref"),
  // Admin classification: does this server communicate outside Wayfinder? Existing
  // rows default to the safe internal classification (ADR-032).
  communicates_externally: boolean("communicates_externally").notNull().default(false),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  created_by_user_id: uuid("created_by_user_id").references(() => core_users.id, {
    onDelete: "set null",
  }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Cache of tools discovered on a server, refreshed on demand. The flow editor
// reads this and falls back to a live listTools when stale/empty.
export const admin_mcp_tools = pgTable(
  "admin_mcp_tools",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    server_id: uuid("server_id")
      .notNull()
      .references(() => admin_mcp_servers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    input_schema: jsonb("input_schema").$type<Record<string, unknown> | null>(),
    last_synced_at: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    server_tool_unique: unique("admin_mcp_tools_server_id_name_unique").on(t.server_id, t.name),
    by_server: index("admin_mcp_tools_server_id_idx").on(t.server_id),
  }),
);
