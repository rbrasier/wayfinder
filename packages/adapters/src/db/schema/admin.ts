import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
