import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  HrColumnMapping,
  McpToolCitationMapping,
  McpToolPagination,
  McpToolStatusMapping,
  WatchApiKeyPlacement,
  WatchCondition,
  WatchInputMapping,
} from "@wayfinder/domain";
import { core_organisations, core_users } from "./core";
import { app_flows } from "./wayfinder";

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
  // Optional owning organisation (ADR-038). Null = global group. `set null` on
  // delete returns the group to global rather than cascading it away.
  organisation_id: uuid("organisation_id").references(() => core_organisations.id, {
    onDelete: "set null",
  }),
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

// Admin-registered remote MCP servers. `sse` is the legacy default;
// `streamable-http` targets the newer MCP streamable-HTTP endpoint. The bearer
// token and custom headers are stored encrypted (`enc:v1:` envelopes) and are
// never returned to a client (ADR-062 §8).
export const admin_mcp_servers = pgTable("admin_mcp_servers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  transport: text("transport", { enum: ["sse", "streamable-http"] }).notNull().default("sse"),
  url: text("url").notNull(),
  // What the server does with data (ADR-062 §1). Rows that predate it were
  // carried across from the dropped `communicates_externally` (0055).
  data_classification: text("data_classification", {
    enum: ["internal", "public-read", "external-write"],
  })
    .notNull()
    .default("internal"),
  // Admin governance of Wayfinder's own handling (ADR-053 §5): when true,
  // Wayfinder selects from or passes through this connection's tool results and
  // never transforms them. Existing rows default to the current behaviour.
  verbatim_only: boolean("verbatim_only").notNull().default(false),
  call_timeout_ms: integer("call_timeout_ms").notNull().default(30000),
  credential_ciphertext: text("credential_ciphertext"),
  // JSON object of header name → value, encrypted as a whole.
  custom_headers_ciphertext: text("custom_headers_ciphertext"),
  // OAuth 2.0 client credentials (issue #361): set together, or all null for a
  // server that does not sign in with OAuth. The client secret is write-only
  // like the token and read only by the secret store.
  oauth_token_url: text("oauth_token_url"),
  oauth_client_id: text("oauth_client_id"),
  oauth_scope: text("oauth_scope"),
  oauth_audience: text("oauth_audience"),
  oauth_client_auth_method: text("oauth_client_auth_method", {
    enum: ["client_secret_basic", "client_secret_post"],
  }),
  oauth_client_secret_ciphertext: text("oauth_client_secret_ciphertext"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  created_by_user_id: uuid("created_by_user_id").references(() => core_users.id, {
    onDelete: "set null",
  }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Cache of tools discovered on a server, refreshed on demand, plus the admin's
// per-tool settings (ADR-062 §5). The flow editor reads this and falls back to a
// live listTools when it is empty.
export const admin_mcp_tools = pgTable(
  "admin_mcp_tools",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    server_id: uuid("server_id")
      .notNull()
      .references(() => admin_mcp_servers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    title: text("title"),
    input_schema: jsonb("input_schema").$type<Record<string, unknown> | null>(),
    pagination_config: jsonb("pagination_config").$type<McpToolPagination | null>(),
    status_config: jsonb("status_config").$type<McpToolStatusMapping | null>(),
    citation_config: jsonb("citation_config").$type<McpToolCitationMapping | null>(),
    last_synced_at: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    server_tool_unique: unique("admin_mcp_tools_server_id_name_unique").on(t.server_id, t.name),
    by_server: index("admin_mcp_tools_server_id_idx").on(t.server_id),
  }),
);

// An Event Watch with its embedded connection (ADR-063 §1). The secret is held
// only as ciphertext and decrypted only on the poller's adapter-internal path.
export const admin_event_watches = pgTable(
  "admin_event_watches",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    url: text("url").notNull(),
    method: text("method", { enum: ["GET", "POST"] }).notNull().default("GET"),
    request_body: jsonb("request_body").$type<unknown>(),
    auth_type: text("auth_type", { enum: ["none", "bearer", "api_key"] })
      .notNull()
      .default("none"),
    api_key_placement: jsonb("api_key_placement").$type<WatchApiKeyPlacement>(),
    secret_encrypted: text("secret_encrypted"),
    interval_minutes: integer("interval_minutes").notNull(),
    items_path: text("items_path").notNull().default(""),
    item_id_path: text("item_id_path").notNull().default(""),
    condition: jsonb("condition").$type<WatchCondition>().notNull(),
    fire_once_per_item: boolean("fire_once_per_item").notNull().default(true),
    max_runs_per_poll: integer("max_runs_per_poll").notNull().default(20),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "restrict" }),
    input_mapping: jsonb("input_mapping").$type<WatchInputMapping>().notNull().default({}),
    run_as_user_id: uuid("run_as_user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
    // Set on create and on any edit to what is polled or how it is judged; the
    // next successful poll records state and starts nothing (ADR-063 §4).
    baseline_pending: boolean("baseline_pending").notNull().default(true),
    consecutive_failures: integer("consecutive_failures").notNull().default(0),
    failure_threshold: integer("failure_threshold").notNull().default(5),
    last_error: text("last_error"),
    paused_reason: text("paused_reason", {
      enum: ["failure_threshold", "run_cap_exceeded", "run_as_unavailable", "flow_unavailable", "manual"],
    }),
    paused_at: timestamp("paused_at", { withTimezone: true }),
    // Regenerated on each pause so the watch_paused alert sends once per pause.
    pause_incident_id: uuid("pause_incident_id"),
    last_polled_at: timestamp("last_polled_at", { withTimezone: true }),
    last_success_at: timestamp("last_success_at", { withTimezone: true }),
    next_poll_at: timestamp("next_poll_at", { withTimezone: true }),
    created_by: uuid("created_by").references(() => core_users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_status_next_poll: index("admin_event_watches_status_next_poll_at_idx").on(
      t.status,
      t.next_poll_at,
    ),
  }),
);

// Last-seen values per (watch, item), so a poll can tell what changed since the
// previous one. Rows outlive an item's absence from a response on purpose.
export const admin_event_watch_item_states = pgTable(
  "admin_event_watch_item_states",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // The foreign key is declared below with an explicit name: the generated one
    // runs one character past Postgres's 63-character identifier limit.
    watch_id: uuid("watch_id").notNull(),
    item_id: text("item_id").notNull(),
    last_values: jsonb("last_values").$type<Record<string, unknown>>().notNull().default({}),
    fired_at: timestamp("fired_at", { withTimezone: true }),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    watch_item_unique: unique("admin_event_watch_item_states_watch_id_item_id_unique").on(
      t.watch_id,
      t.item_id,
    ),
    watch_fk: foreignKey({
      columns: [t.watch_id],
      foreignColumns: [admin_event_watches.id],
      name: "admin_event_watch_item_states_watch_id_fk",
    }).onDelete("cascade"),
  }),
);
