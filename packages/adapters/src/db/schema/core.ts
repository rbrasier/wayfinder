import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const core_users = pgTable("core_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name"),
  is_admin: boolean("is_admin").notNull().default(false),
  cert_fingerprint: text("cert_fingerprint"),
  cert_subject_dn: text("cert_subject_dn"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const core_sessions = pgTable("core_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id")
    .notNull()
    .references(() => core_users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const core_verification_tokens = pgTable("core_verification_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  identifier: text("identifier").notNull(),
  token: text("token").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const core_audit_log = pgTable("core_audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  actor_id: uuid("actor_id"),
  action: text("action").notNull(),
  resource_type: text("resource_type").notNull(),
  resource_id: text("resource_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const core_feature_flag = pgTable("core_feature_flag", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  rollout_pct: real("rollout_pct").notNull().default(100),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
