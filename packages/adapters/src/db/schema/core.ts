import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// An internal sharing/visibility scope (ADR-038), one rung coarser than a group.
// It carries no data-isolation semantics: no other table gains an
// `organisation_id`, and there is no RLS. A flow published with `organisation`
// visibility is discoverable by users who share its owner's organisation.
export const core_organisations = pgTable("core_organisations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Optional descriptive email domain (e.g. "acme.com"), editable by an admin.
  email_domain: text("email_domain"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const core_users = pgTable("core_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role"),
  team: text("team"),
  // Nullable: null means unaffiliated, behaving identically to the
  // pre-organisation app (ADR-038). `on delete set null` returns members to
  // unaffiliated if their organisation is removed.
  organisation_id: uuid("organisation_id").references(() => core_organisations.id, {
    onDelete: "set null",
  }),
  is_admin: boolean("is_admin").notNull().default(false),
  email_verified: boolean("email_verified").notNull().default(false),
  image: text("image"),
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
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const core_accounts = pgTable("core_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id")
    .notNull()
    .references(() => core_users.id, { onDelete: "cascade" }),
  account_id: text("account_id").notNull(),
  provider_id: text("provider_id").notNull(),
  password: text("password"),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  id_token: text("id_token"),
  access_token_expires_at: timestamp("access_token_expires_at", { withTimezone: true }),
  refresh_token_expires_at: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
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

// Append-only and tamper-evident (ADR-033). This is the one table that omits
// `updated_at`: a row is written once and never updated, enforced by a reject
// trigger installed in the same migration. `sequence`/`prev_hash`/`hash` form a
// hash chain a verifier can recompute to detect any altered or missing row.
export const core_audit_log = pgTable("core_audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  actor_id: uuid("actor_id"),
  action: text("action").notNull(),
  resource_type: text("resource_type").notNull(),
  resource_id: text("resource_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
  prev_hash: text("prev_hash"),
  hash: text("hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Backs the retention sweep's oldest-first range scan (scaling wall #9).
  by_created: index("core_audit_log_created_at_idx").on(t.created_at),
  // The chain is linked by sequence; the writer reads the max-sequence row's
  // hash, and the verifier walks rows in sequence order.
  by_sequence: uniqueIndex("core_audit_log_sequence_idx").on(t.sequence),
}));

export const core_feature_flag = pgTable("core_feature_flag", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  rollout_pct: real("rollout_pct").notNull().default(100),
  description: text("description"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
