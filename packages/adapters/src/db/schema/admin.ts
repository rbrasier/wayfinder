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
